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
   */
  discoveryCandidates: [
    'http://gateflame.local',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://192.168.1.105',
    'http://192.168.1.100',
    'http://192.168.0.105',
    'http://192.168.8.105',
    'http://10.0.0.105',
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
