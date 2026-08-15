/**
 * Gate^Flame — runtime configuration.
 *
 * Single place where environment and endpoint constants are resolved. Before
 * this file existed, `192.168.1.105`, `192.168.1.100` and `localhost:8080` were
 * hardcoded across five components, so a customer on a 10.0.0.0/8 network was a
 * rebuild rather than a config change.
 */

const bool = (v: string | undefined): boolean => v === 'true' || v === '1';

const int = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Strip any trailing slash so `${base}${path}` never doubles up. */
const normaliseBase = (v: string | undefined): string | null => {
  if (!v) return null;
  const trimmed = v.trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : null;
};

export const config = {
  /** Explicit node URL, if the operator pinned one. Otherwise discovery runs. */
  nodeBaseUrl: normaliseBase(import.meta.env.VITE_NODE_BASE_URL),

  /** Force simulation even when a node is reachable. Sales-demo switch. */
  forceMockData: bool(import.meta.env.VITE_USE_MOCK_DATA),

  /** Never silently fall back to simulation — surface the error instead. */
  strictLive: bool(import.meta.env.VITE_STRICT_LIVE),

  apiTimeoutMs: int(import.meta.env.VITE_API_TIMEOUT_MS, 4000),
  pollIntervalMs: int(import.meta.env.VITE_POLL_INTERVAL_MS, 4000),

  /** API version prefix. Matches docs/PAIRING-AND-TELEMETRY.md. */
  apiPrefix: '/api/v1',

  /** localStorage key holding the paired device token. */
  tokenStorageKey: 'gateflame-device-token',

  /**
   * Candidate node addresses, tried in order during discovery.
   *
   * mDNS first — the node advertises `gateflame.local`, so this works on any
   * subnet without the customer typing an IP. The literals after it are the
   * default gateway-adjacent addresses of the routers actually sold in South
   * Africa, plus loopback for the kiosk, which reaches its own agent directly.
   *
   * ⚠ EVERY ENTRY MUST CARRY THE PORT. node-agent binds GATEFLAME_PORT, which
   * defaults to 8080 — see node-agent/gateflame/config.py and the systemd unit
   * in node-agent/install.sh. The original list omitted `:8080` on six of the
   * eight entries, so those resolved to port 80, where nothing listens. The
   * effect was that discovery could only ever succeed from the kiosk's own
   * loopback: a phone on a real LAN always fell through to "No Gate^Flame node
   * found on this network", and could not recover, because until the manual
   * entry added alongside this there was no other way to reach a node.
   *
   * The bare port-80 name is kept last, for the day the agent sits behind a
   * reverse proxy. Probing is a Promise.any race, so a dead candidate costs
   * one socket and no wall-clock time.
   */
  discoveryCandidates: [
    'http://gateflame.local:8080',
    // Raspberry Pi OS publishes <hostname>.local over avahi out of the box, and
    // the stock hostname is `raspberrypi`. This works BEFORE deploy-on-pi.sh
    // has published the gateflame.local alias, which matters on a first run and
    // on any node where the alias step failed.
    'http://raspberrypi.local:8080',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    // Common static-lease addresses. EVERY entry must carry :8080 - the agent
    // binds 8080, and a bare host resolves to :80. `.10` is as common a
    // reservation as `.105` and was missing entirely.
    'http://192.168.0.10:8080',
    'http://192.168.1.10:8080',
    'http://192.168.1.105:8080',
    'http://192.168.1.100:8080',
    'http://192.168.0.105:8080',
    'http://192.168.8.105:8080',
    'http://10.0.0.105:8080',
    // Deliberate: the one bare port-80 entry, kept last, for the day the agent
    // sits behind a reverse proxy. Not an instance of the missing-port defect.
    'http://gateflame.local',
  ] as const,
} as const;

/**
 * True when the app is running as the on-device kiosk rather than the phone.
 *
 * The kiosk is served from the node itself over loopback, which is what grants
 * it `kiosk` scope — physical presence at the appliance. See
 * docs/PAIRING-AND-TELEMETRY.md §3.2.
 */
export const isKioskContext = (): boolean => {
  if (typeof window === 'undefined') return false;
  const { hostname, pathname } = window.location;
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  return loopback || pathname.includes('device-kiosk') || pathname.includes('kiosk.html');
};
