/**
 * Gate^Flame node API — wire contract.
 *
 * This is the TypeScript half of the contract specified in
 * docs/PAIRING-AND-TELEMETRY.md. The `node-agent` backend implements the other
 * half. Both sides build against these shapes, so the rebuild has a target
 * rather than a guess.
 *
 * Nothing here is optional-by-accident: a field is `?` only when the node may
 * genuinely omit it (degraded module, absent sensor). That is the point of the
 * honest-capability-reporting design — a missing thermal sensor produces
 * `status: 'degraded'` with a named `gap`, not a fabricated temperature.
 */

import type {
  SystemTelemetry,
  ThreatLogEntry,
  ConnectedClient,
} from '../types';

/* ── Envelope ─────────────────────────────────────────────────────────── */

export interface ApiError {
  error: string;
  message?: string;
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
}

/** Every module reports what it can genuinely do on *this* host. */
export type ModuleStatus = 'running' | 'degraded' | 'stopped' | 'starting' | 'stopping' | 'failed';

export interface ModuleState {
  id: string;
  status: ModuleStatus;
  /** Named capability gap when degraded, e.g. "no CAP_NET_ADMIN". */
  gap?: string;
  /** Concrete remedy shown on the card, e.g. "grant CAP_NET_ADMIN to the unit". */
  remedy?: string;
  /** What this module cooperates with, e.g. ["Pi-hole", "dnsmasq"]. */
  uses?: string[];
  restarts24h?: number;
  startedAt?: string;
}

/* ── GET /api/v1/system/status ────────────────────────────────────────── */

export interface NodeStatusResponse {
  nodeId: string;
  nodeName: string;
  agentVersion: string;
  uptimeSeconds: number;
  protectionStatus: SystemTelemetry['protectionStatus'];
  filterLevel: SystemTelemetry['filterLevel'];
  piholeReachable: boolean;
  host: {
    cpuPercent: number;
    memUsedMB: number;
    memTotalMB: number;
    diskUsedPercent: number;
    /** Absent when the host exposes no thermal zone — do not invent one. */
    tempC?: number;
    throttleFlags?: string;
  };
}

/* ── GET /api/v1/telemetry/summary ────────────────────────────────────── */

export interface TelemetrySummaryResponse {
  totalQueriesToday: number;
  queriesBlockedToday: number;
  blockPercentage: number;
  domainsOnGravity: number;
  activeClientsCount: number;
  dataSavedMB: number;
  avgLatencyMs: number;
  uptimeSeconds: number;
  protectionStatus: SystemTelemetry['protectionStatus'];
  filterLevel: SystemTelemetry['filterLevel'];
  pauseTimeRemainingSeconds: number;
}

/* ── GET /api/v1/threats/recent?limit=N ───────────────────────────────── */

export interface ThreatLogResponse {
  entries: ThreatLogEntry[];
  /** Server-side total, which may exceed what was returned. */
  total: number;
}

/* ── GET /api/v1/clients ──────────────────────────────────────────────── */

export interface ClientsResponse {
  clients: ConnectedClient[];
}

/* ── GET /api/v1/services ─────────────────────────────────────────────── */

export interface ServicesResponse {
  modules: ModuleState[];
}

/* ── POST /api/v1/services/{slug}/{start|stop} ────────────────────────── */

export interface ServiceActionResponse {
  id: string;
  status: ModuleStatus;
  gap?: string;
  remedy?: string;
  /**
   * Set when the node performed the action in name only — e.g. a firewall
   * bounce recorded with no packet-filter control. The UI must surface this
   * rather than showing a green light. See the "RECORDED ONLY" convention in
   * the backend build record.
   */
  advisory?: string;
}

/* ── GET /api/v1/modules/{slug}/metrics ───────────────────────────────── */

export interface ModuleMetricPoint {
  /** ISO-8601. The node owns time; the client never invents timestamps. */
  t: string;
  value1: number;
  value2: number;
}

export interface ModuleMetricsResponse {
  id: string;
  /** Four headline tiles, in display order. */
  tiles: Array<{ label: string; value: string; unit?: string }>;
  series: ModuleMetricPoint[];
}

/* ── Pairing — docs/PAIRING-AND-TELEMETRY.md §3.1 ─────────────────────── */

export interface PairRequestResponse {
  code: string;
  expiresAt: string;
  attemptsRemaining: number;
}

export interface PairClaimRequest {
  code: string;
  deviceName: string;
}

export type ApiScope = 'read' | 'control' | 'kiosk';

export interface PairClaimResponse {
  deviceToken: string;
  nodeId: string;
  nodeName: string;
  scopes: ApiScope[];
}

export interface PairedDevice {
  id: string;
  deviceName: string;
  pairedAt: string;
  lastSeenAt?: string;
  scopes: ApiScope[];
}

export interface PairedDevicesResponse {
  devices: PairedDevice[];
}

/* ── Connection state, client-side ────────────────────────────────────── */

/**
 * `demo` is never silently equivalent to `live`. Every surface that renders
 * data must be able to say which one it is showing — that is the whole reason
 * this union exists rather than a boolean `isConnected`.
 */
export type DataSource = 'live' | 'demo' | 'connecting' | 'error';

export interface ConnectionState {
  dataSource: DataSource;
  /** Resolved base URL once discovery succeeds. */
  nodeBaseUrl: string | null;
  nodeId: string | null;
  nodeName: string | null;
  agentVersion: string | null;
  /** Human-readable reason the app is not live. Shown in the banner. */
  lastError: string | null;
  lastSuccessAt: string | null;
  /** True when simulation was forced by config rather than by failure. */
  mockForced: boolean;
}
