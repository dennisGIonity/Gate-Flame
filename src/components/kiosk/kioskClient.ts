/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: transport layer
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The console's own transport. Deliberately NOT src/services/gateflameApi.ts.
 *
 * gateflameApi is right for the phone: when the node cannot be reached it drops
 * to mockAdapter so a salesperson can demo without a Pi on the table. On the
 * appliance's own face that behaviour would be a lie — the screen bolted to the
 * box would show invented numbers about the very network it is failing to
 * protect. So this module has NO fallback path at all. Unreachable renders as
 * unreachable. See docs/KIOSK-REBUILD-PROMPT.md, "THE ONE RULE".
 *
 * Every interface below was typed by reading node-agent/gateflame/*.py, not by
 * reading the prompt that described them. That distinction already caught one
 * live defect: the previous kiosk rendered `entry.severity` and `entry.sourceIp`
 * on the threat list, while threats.py emits `{timestamp, domain, clientIp,
 * action}`. It has never been visible because `entries` is always empty until a
 * Pi-hole API URL is configured — it would have appeared on the first customer
 * box that actually worked.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilteringState, PauseDurationId, ThreatLevelId } from '../../types/filtering';
import type {
  VpnDeviceState,
  VpnDevicesResponse,
  VpnGateConfigResponse,
  VpnProvider,
  VpnRegionsResponse,
} from '../../types/vpn';

// ---------------------------------------------------------------------------
// Where the node is
// ---------------------------------------------------------------------------

/**
 * The console is served BY the agent, from the agent's own static mount at
 * /device-kiosk. So the agent is always same-origin, and same-origin is the
 * only correct answer for it: hardcoding `localhost:8080` would break the
 * moment the port moves (GATEFLAME_PORT is configurable), and would silently
 * talk to the WRONG node if that page were ever opened against a different box.
 *
 * The dev-server fallback exists because `npm run dev` serves on :3000 while
 * the agent stays on :8080.
 *
 * THE PHONE OVERRIDES THIS. The console is same-origin; the phone is not.
 *
 * The paired app talks to a node across the LAN and must send a bearer token,
 * neither of which same-origin can express. Rather than give the phone a second
 * copy of this client - which is precisely how the first mobile app drifted
 * away from the console and had to be scrapped - the transport is injected and
 * everything else here is shared verbatim.
 *
 * Unset by default, so the console's behaviour is byte-for-byte what it was.
 */
interface NodeTransport {
  /** Absolute base, e.g. `http://192.168.0.10:8080`. No trailing slash. */
  baseUrl: string;
  /** Bearer token for a paired device, or null while unpaired. */
  authToken: () => string | null;
}

let transport: NodeTransport | null = null;

export function configureNodeTransport(t: NodeTransport | null): void {
  transport = t ? { ...t, baseUrl: t.baseUrl.replace(/\/+$/, '') } : null;
}

export function apiRoot(): string {
  if (transport) return `${transport.baseUrl}/api/v1`;
  if (typeof window === 'undefined') return 'http://localhost:8080/api/v1';
  const { origin, port } = window.location;
  if (port === '3000' || port === '5173') {
    // Lets a local demo point at a node-agent running on a non-default port
    // (e.g. when 8080 is already taken by something else on the same
    // workstation), without touching the production same-origin path below.
    // Stays same-origin from the BROWSER's point of view — vite.config.ts's
    // dev proxy (also gated on VITE_DEV_NODE_PORT) is what actually forwards
    // it server-side. A direct cross-port URL here would still be same-origin
    // as far as this app's own CORS setup is concerned, but some embedded
    // browser contexts refuse cross-origin fetches outright regardless of the
    // target's CORS headers, so same-origin is the more robust choice.
    const devPort = (import.meta as { env?: Record<string, string> }).env?.VITE_DEV_NODE_PORT;
    return devPort ? `${origin}/api/v1` : 'http://localhost:8080/api/v1';
  }
  return `${origin}/api/v1`;
}

/**
 * Whether this page is the appliance's own console or merely a viewer.
 *
 * The node grants `kiosk` scope from a LOOPBACK SOURCE ADDRESS — physical
 * presence at the box — and never from a bearer token (security.py). The
 * previous `isKioskContext()` in src/config/env.ts inferred kiosk-ness from the
 * URL path instead, so a phone opening `http://<node>:8080/device-kiosk`
 * believed it was the console and then took a 401 the first time anyone pressed
 * a button. Proven against a live agent: 127.0.0.1 → allowed, and the Pi's own
 * LAN address 192.168.0.10 → 401.
 *
 * Here the two agree by construction: authority comes from the socket, so we
 * read the socket. A LAN viewer gets a correct, explained, read-only console
 * instead of buttons that cannot work. (STATE doc, outstanding item 8.)
 */
export type ConsoleAuthority = 'console' | 'viewer';

export function consoleAuthority(): ConsoleAuthority {
  if (typeof window === 'undefined') return 'viewer';
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
    ? 'console'
    : 'viewer';
}

// ---------------------------------------------------------------------------
// Response contracts — typed from node-agent/gateflame/*.py
// ---------------------------------------------------------------------------

export interface SystemStatus {
  nodeId: string;
  nodeName?: string | null;
  agentVersion: string;
  provisioned: boolean;
}

export interface HostTelemetry {
  cpuPercent: number | null;
  memUsedMB: number | null;
  memTotalMB: number | null;
  diskUsedPercent: number | null;
  uptimeSeconds: number | null;
  tempC: number | null;
  /** `0x0` is healthy. Anything else is a throttle or undervoltage event. */
  throttleFlags: string | null;
}

export interface TelemetrySummary {
  totalQueriesToday: number | null;
  queriesBlockedToday: number | null;
  blockPercentage: number | null;
  domainsOnGravity: number | null;
  activeClientsCount: number | null;
  dataSavedMB: number | null;
  avgLatencyMs: number | null;
  uptimeSeconds: number | null;
  host: HostTelemetry | null;
  piholeReachable: boolean;
  gap?: string | null;
}

export interface LanClient {
  ip: string;
  mac: string;
  /** Frequently null. IP is the primary identifier; never invent a name. */
  hostname: string | null;
  interface: string;
}

export type ModuleStatus = 'running' | 'stopped' | 'degraded' | 'not_implemented' | 'starting' | 'stopping' | 'failed';

export interface ServiceModule {
  id: string;
  label: string;
  status: ModuleStatus;
  gap?: string | null;
}

/**
 * threats.py, ported to the Pi-hole v6 authenticated query API 2026-08-17.
 *
 * Field names read off the live node, not from documentation. `timestamp` is
 * unix seconds as a float; `status` is FTL's own verdict passed through
 * verbatim (GRAVITY, DENYLIST_CNAME, REGEX, EXTERNAL_BLOCKED_*) so the screen
 * can say WHY something was blocked rather than just that it was.
 *
 * The route returns blocked queries only — a cached lookup of google.com is not
 * a threat, and a wall display has no business holding the household's whole
 * browsing history.
 */
export interface ThreatEntry {
  timestamp: number | string | null;
  domain: string | null;
  clientIp: string | null;
  /** Usually null. Never inferred — a guessed device name on a security log is worse than none. */
  clientName: string | null;
  queryType: string | null;
  status: string;
  action: 'Blocked' | string;
  blocked: boolean;
}

export interface ThreatsResponse {
  entries: ThreatEntry[];
  source: 'pihole' | 'none' | string;
  /** How many recent queries were examined to find these. */
  scanned?: number;
  /** How many were blocked in that window — may exceed entries.length. */
  blockedInWindow?: number;
  gap?: string | null;
}

export interface PairResponse {
  code: string;
  expiresAt: string;
  attemptsRemaining: number;
}

export interface PairedDevice {
  id: string;
  deviceName?: string | null;
  scopes?: string[];
  createdAt?: string | number | null;
  lastSeenAt?: string | number | null;
}

/** firewall.py bounced() — parsed straight out of the kernel set. */
export interface BouncedEntry {
  address?: string;
  elem?: string;
  expires?: number | string | null;
  [k: string]: unknown;
}

export interface WanBudget {
  iface: string;
  month: string;
  usedBytes: number | null;
  rxBytes: number | null;
  txBytes: number | null;
  capBytes: number | null;
  percentOfCap: number | null;
  projectedTotalBytes: number | null;
  carryOverBytes: number | null;
  gap?: string | null;
}

export interface WanSummary {
  interfaces: Record<string, WanBudget>;
  link: Record<string, unknown> | null;
  gap?: string | null;
}

export interface PostureFinding {
  id: string;
  severity: string;
  title: string;
  observed: string;
  remedy: string;
}

export interface PostureGap {
  id: string;
  reason: string;
  remedy: string;
}

export interface PostureAudit {
  findings: PostureFinding[];
  gaps: PostureGap[];
  worstSeverity: string | null;
  readOnly?: boolean;
  gap?: string | null;
}

/** dpi.py snapshot() — hostnames only, no payload, ECH flows invisible. */
export interface FlowEntry {
  source: string;
  hostname: string;
  protocol: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

export interface FlowsResponse {
  flows: FlowEntry[];
  truncated: boolean;
  evictions: number;
  note: string;
}

export interface KioskMount {
  mounted: boolean;
  path: string | null;
  directory: string;
  gap: string | null;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export class NodeError extends Error {
  readonly status: number | null;
  /** True when nothing answered — as opposed to the node answering "no". */
  readonly unreachable: boolean;

  constructor(message: string, status: number | null, unreachable: boolean) {
    super(message);
    this.name = 'NodeError';
    this.status = status;
    this.unreachable = unreachable;
  }
}

const TIMEOUT_MS = 4000;

export async function nodeRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Chain the caller's signal so an unmounting component cancels the socket
  // rather than leaving polls to stack up behind a stalled node.
  const onAbort = () => controller.abort();
  init.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // The console sends no Authorization header and must not start: its scope
    // comes from the loopback socket, and a token would be both useless and a
    // second source of truth about who is allowed to do what.
    const headers: Record<string, string> = {};
    if (init.body) headers['Content-Type'] = 'application/json';
    const token = transport?.authToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${apiRoot()}${path}`, {
      method: init.method ?? 'GET',
      headers: Object.keys(headers).length ? headers : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = `${res.status}`;
      try {
        const parsed = await res.json();
        const d = parsed?.detail;
        if (typeof d === 'string') detail = d;
        else if (d?.advisory) detail = String(d.advisory);
        else if (d?.error) detail = String(d.error);
      } catch {
        /* non-JSON error body: the status alone is the message */
      }
      throw new NodeError(detail, res.status, false);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof NodeError) throw err;
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    throw new NodeError(
      aborted ? 'the node did not answer within 4 seconds' : 'no route to the node agent',
      null,
      true,
    );
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Writes. Every one of these needs scope the node grants from the socket.
// ---------------------------------------------------------------------------

export const kioskApi = {
  requestPairingCode: () => nodeRequest<PairResponse>('/pair/request', { method: 'POST' }),
  revokeDevice: (id: string) => nodeRequest<{ ok: boolean }>(`/pair/devices/${id}`, { method: 'DELETE' }),
  revokeAll: () => nodeRequest<{ ok: boolean }>('/pair/devices/revoke-all', { method: 'POST' }),

  setThreatLevel: (level: ThreatLevelId) =>
    nodeRequest<FilteringState>('/filtering/threat-level', { method: 'PUT', body: { level } }),

  setCategories: (categories: string[]) =>
    nodeRequest<FilteringState>('/filtering/categories', { method: 'PUT', body: { categories } }),

  pauseFiltering: (duration: PauseDurationId, reason?: string) =>
    nodeRequest<FilteringState>('/filtering/pause', { method: 'POST', body: { duration, reason } }),

  resumeFiltering: () => nodeRequest<FilteringState>('/filtering/resume', { method: 'POST' }),

  startModule: (id: string) => nodeRequest<unknown>(`/services/${id}/start`, { method: 'POST' }),
  stopModule: (id: string) => nodeRequest<unknown>(`/services/${id}/stop`, { method: 'POST' }),

  releaseBounce: (address: string) =>
    nodeRequest<unknown>(`/firewall/bounce/${encodeURIComponent(address)}`, { method: 'DELETE' }),

  // -------------------------------------------------------------------
  // Gate^Flame Shield (per-device VPN). See node-agent/gateflame/vpn.py -
  // the box never carries this traffic, it only issues per-device configs,
  // so writes here are cheap and do not need the blocklists.py-style
  // background-apply dance.
  // -------------------------------------------------------------------

  setVpnDevice: (mac: string, region: string | null, enabled: boolean, provider: VpnProvider = 'headscale') =>
    nodeRequest<VpnDeviceState>(`/vpn/devices/${encodeURIComponent(mac)}`, {
      method: 'PUT',
      body: { region, enabled, provider },
    }),

  // vpngate-backed devices only - the actual importable .ovpn text, fetched
  // fresh (never cached) since VPN Gate's own server list rotates.
  getVpnGateConfig: (mac: string) =>
    nodeRequest<VpnGateConfigResponse>(`/vpn/devices/${encodeURIComponent(mac)}/vpngate-config`),
};

// ---------------------------------------------------------------------------
// Polling
// ---------------------------------------------------------------------------

export interface Polled<T> {
  data: T | null;
  error: NodeError | null;
  /** When this endpoint last answered successfully. Null = never has. */
  lastSeen: Date | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Poll one endpoint. One request in flight at a time — a node under load must
 * not accumulate a queue of identical GETs behind a slow one.
 *
 * `enabled` is false for panels the operator is not looking at: eight tabs
 * polling everything at 4s would be forty requests a minute at a Pi that has
 * better things to do.
 */
export function usePolled<T>(path: string, intervalMs: number, enabled = true): Polled<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<NodeError | null>(null);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const controller = new AbortController();

    const tick = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const result = await nodeRequest<T>(path, { signal: controller.signal });
        if (cancelled) return;
        setData(result);
        setError(null);
        setLastSeen(new Date());
      } catch (err) {
        if (cancelled) return;
        // Keep the last good payload in state, but publish the error too. The
        // shell greys the screen and stamps it with lastSeen; what it must
        // never do is keep presenting stale numbers as if they were live.
        setError(err instanceof NodeError ? err : new NodeError('unknown failure', null, true));
      } finally {
        inFlight.current = false;
        if (!cancelled) setLoading(false);
      }
    };

    void tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(id);
    };
  }, [path, intervalMs, enabled, nonce]);

  return { data, error, lastSeen, loading, refresh };
}

// ---------------------------------------------------------------------------
// Sample history
// ---------------------------------------------------------------------------

export interface Sample {
  t: number;
  v: number | null;
}

/**
 * Keep the last N real polled values so a chart has something to draw.
 *
 * ⚠ THIS IS NOT HISTORY. It is a ring buffer in a browser tab, and it dies with
 * the page. The node has four tables — node_identity, pairing_codes,
 * pairing_attempts, devices — and not one of them stores a measurement, so
 * "including yesterday's" (END-GAME PLAN E6) is not merely unimplemented in the
 * UI, it is unimplemented in the product. Every chart drawn from this hook is
 * therefore labelled with the moment sampling began, and no chart offers a
 * range selector it cannot honour.
 *
 * `null` is recorded as a genuine gap and drawn as a break in the line, never
 * interpolated across — a missing sample and a zero mean opposite things.
 */
export function useSeries(value: number | null | undefined, cap = 90): { samples: Sample[]; since: number } {
  const [samples, setSamples] = useState<Sample[]>([]);
  const since = useRef(Date.now());

  useEffect(() => {
    if (value === undefined) return; // not yet fetched — not a gap
    setSamples((prev) => {
      const next = [...prev, { t: Date.now(), v: value ?? null }];
      return next.length > cap ? next.slice(next.length - cap) : next;
    });
  }, [value, cap]);

  return { samples, since: since.current };
}

// ---------------------------------------------------------------------------
// Formatters — every one returns the em-dash for unknown, never a zero
// ---------------------------------------------------------------------------

export const DASH = '—';

export const num = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined || Number.isNaN(v) ? DASH : v.toLocaleString('en-ZA', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

export const pct = (v: number | null | undefined): string =>
  v === null || v === undefined ? DASH : `${v.toFixed(1)}%`;

export function bytes(v: number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = v;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return DASH;
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function clockTime(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleTimeString('en-ZA', { hour12: false });
}
