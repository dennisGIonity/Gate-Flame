/**
 * Gate^Flame — the seam.
 *
 * One facade the UI calls. Underneath it is a real node or nothing, and the
 * caller is always told which. This is the single place where that decision is
 * made.
 *
 * Resolution order:
 *   1. A node answers discovery  → live.
 *   2. VITE_STRICT_LIVE=true     → error. Data calls throw.
 *   3. Otherwise                 → offline. Data calls return EMPTY responses.
 *
 * "Empty" is the load-bearing word. Until 2026-09-10 step 3 routed to a
 * simulator (`mockAdapter`) that generated plausible telemetry, threat rows and
 * client lists behind an amber banner. That file is deleted. An unreachable
 * node now yields nulls and empty lists — `lib/format.ts` renders a null as
 * "—" — so nothing on any screen can be a number the app made up.
 */

import { config } from '../config/env';
import { apiRequest, ApiRequestError, storeToken } from './apiClient';
import { discoverNode } from './nodeDiscovery';
import type {
  ClientsResponse,
  ConnectionState,
  ModuleMetricsResponse,
  PairClaimResponse,
  PairedDevicesResponse,
  PairRequestResponse,
  ServiceActionResponse,
  ServicesResponse,
  TelemetrySummaryResponse,
  ThreatLogResponse,
} from '../types/api';
import type { SystemTelemetry } from '../types';

/* ── Honest empties ──────────────────────────────────────────────────── */

/**
 * The summary returned while offline. Every measured field is null; the
 * local-only fields (protection/pause/filter) are carried over from the
 * previous value so a paused state is not silently un-paused by a network
 * blip.
 */
export const emptyTelemetry = (prev: SystemTelemetry): TelemetrySummaryResponse => ({
  totalQueriesToday: null,
  queriesBlockedToday: null,
  blockPercentage: null,
  domainsOnGravity: null,
  activeClientsCount: null,
  dataSavedMB: null,
  avgLatencyMs: null,
  uptimeSeconds: 0,
  protectionStatus: prev.protectionStatus,
  filterLevel: prev.filterLevel,
  pauseTimeRemainingSeconds: prev.pauseTimeRemainingSeconds,
});

export const EMPTY_THREATS: ThreatLogResponse = { entries: [], total: 0 };
export const EMPTY_CLIENTS: ClientsResponse = { clients: [] };
export const EMPTY_SERVICES: ServicesResponse = { modules: [] };
export const emptyModuleMetrics = (id: string): ModuleMetricsResponse => ({
  id,
  tiles: [],
  series: [],
});

let connection: ConnectionState = {
  dataSource: 'connecting',
  nodeBaseUrl: null,
  nodeId: null,
  nodeName: null,
  agentVersion: null,
  lastError: null,
  lastSuccessAt: null,
};

type Listener = (state: ConnectionState) => void;
const listeners = new Set<Listener>();

const setConnection = (patch: Partial<ConnectionState>): void => {
  connection = { ...connection, ...patch };
  listeners.forEach((l) => l(connection));
};

export const getConnection = (): ConnectionState => connection;

export const subscribeConnection = (listener: Listener): (() => void) => {
  listeners.add(listener);
  listener(connection);
  return () => listeners.delete(listener);
};

const isLive = (): boolean => connection.dataSource === 'live' && connection.nodeBaseUrl !== null;

/**
 * Establish the data source. Safe to call repeatedly — used on mount and to
 * retry from the banner.
 */
export async function connect(signal?: AbortSignal): Promise<ConnectionState> {
  setConnection({ dataSource: 'connecting', lastError: null });

  try {
    const { baseUrl, status } = await discoverNode(signal);
    setConnection({
      dataSource: 'live',
      nodeBaseUrl: baseUrl,
      nodeId: status.nodeId,
      nodeName: status.nodeName,
      agentVersion: status.agentVersion,
      lastError: null,
      lastSuccessAt: new Date().toISOString(),
    });
  } catch (err) {
    const reason =
      err instanceof ApiRequestError
        ? err.message
        : 'Could not reach a Gate^Flame node on this network.';

    setConnection({
      dataSource: config.strictLive ? 'error' : 'offline',
      nodeBaseUrl: null,
      nodeId: null,
      nodeName: null,
      agentVersion: null,
      lastError: reason,
    });
  }

  return connection;
}

/**
 * Run a live call, and on unreachability drop to `offline` and return the
 * caller's honest empty rather than throwing at the UI. A node that goes away
 * mid-session must degrade visibly — dashes and an amber banner — not blank
 * the whole dashboard, and never fill it with invented numbers.
 */
async function liveOrEmpty<T>(call: (baseUrl: string) => Promise<T>, empty: () => T): Promise<T> {
  if (isLive() && connection.nodeBaseUrl) {
    try {
      const result = await call(connection.nodeBaseUrl);
      setConnection({ lastSuccessAt: new Date().toISOString(), lastError: null });
      return result;
    } catch (err) {
      if (err instanceof ApiRequestError && err.isUnreachable) {
        if (config.strictLive) {
          setConnection({ dataSource: 'error', lastError: err.message });
          throw err;
        }
        setConnection({
          dataSource: 'offline',
          nodeBaseUrl: null,
          lastError: `Lost contact with the node: ${err.message}`,
        });
        return empty();
      }
      // The node answered and refused. That is a real answer — surface it.
      throw err;
    }
  }

  if (connection.dataSource === 'error') {
    throw new ApiRequestError(connection.lastError ?? 'Not connected to a node');
  }

  return empty();
}

export const gateflameApi = {
  connect,
  getConnection,
  subscribeConnection,

  telemetry: (prev: SystemTelemetry) =>
    liveOrEmpty<TelemetrySummaryResponse>(
      (base) => apiRequest<TelemetrySummaryResponse>(base, '/telemetry/summary'),
      () => emptyTelemetry(prev),
    ),

  threats: (limit = 20) =>
    liveOrEmpty<ThreatLogResponse>(
      (base) => apiRequest<ThreatLogResponse>(base, `/threats/recent?limit=${limit}`),
      () => EMPTY_THREATS,
    ),

  clients: () =>
    liveOrEmpty<ClientsResponse>(
      (base) => apiRequest<ClientsResponse>(base, '/clients'),
      () => EMPTY_CLIENTS,
    ),

  services: () =>
    liveOrEmpty<ServicesResponse>(
      (base) => apiRequest<ServicesResponse>(base, '/services'),
      () => EMPTY_SERVICES,
    ),

  moduleMetrics: (moduleId: string) =>
    liveOrEmpty<ModuleMetricsResponse>(
      (base) => apiRequest<ModuleMetricsResponse>(base, `/modules/${moduleId}/metrics`),
      () => emptyModuleMetrics(moduleId),
    ),

  /**
   * Start or stop a module.
   *
   * Note the asymmetry, which is enforced by the node and not by this client:
   * starting is allowed from a paired handset (recovering protection is what a
   * remote is for), stopping requires kiosk scope — it persists across reboots
   * and tears down the firewall table, so a stolen phone must not be able to
   * switch the product off. See docs/PAIRING-AND-TELEMETRY.md §3.2.
   */
  toggleService: (moduleId: string, slug: string, enable: boolean): Promise<ServiceActionResponse> => {
    // A control action has no honest empty. Pretending a module started when
    // no node exists is exactly the fiction this seam was built to prevent, so
    // offline it refuses — loudly, with the module named.
    const verb = enable ? 'start' : 'stop';
    if (!isLive() || !connection.nodeBaseUrl) {
      return Promise.reject(
        new ApiRequestError(`No node connected — cannot ${verb} ${moduleId}. Nothing on your network changed.`),
      );
    }
    return liveOrEmpty<ServiceActionResponse>(
      (base) =>
        apiRequest<ServiceActionResponse>(base, `/services/${slug}/${verb}`, { method: 'POST' }),
      () => {
        throw new ApiRequestError(`Lost contact with the node while trying to ${verb} ${moduleId}.`);
      },
    );
  },

  /**
   * Pairing has no offline fallback — either a real node answers, or the screen
   * shows a real error. Faking a pairing code would be worse than useless.
   *
   * `requestPairingCode` is only ever called from the kiosk, which reaches
   * its own node over loopback and therefore carries `kiosk` scope with no
   * bearer token — see docs/PAIRING-AND-TELEMETRY.md §3.1/§3.2.
   */
  requestPairingCode: (): Promise<PairRequestResponse> => {
    if (!connection.nodeBaseUrl) {
      throw new ApiRequestError('No node connection — the kiosk must be live to issue a pairing code.');
    }
    return apiRequest<PairRequestResponse>(connection.nodeBaseUrl, '/pair/request', { method: 'POST' });
  },

  /**
   * Called from the phone, against whichever node it just discovered. Takes
   * an explicit `baseUrl` rather than reading `connection` because the app
   * may be claiming against a node it found seconds ago and hasn't yet
   * marked `live` — pairing is what makes it live.
   */
  claimPairingCode: async (baseUrl: string, code: string, deviceName: string): Promise<PairClaimResponse> => {
    const result = await apiRequest<PairClaimResponse>(baseUrl, '/pair/claim', {
      method: 'POST',
      body: { code, deviceName },
      anonymous: true,
    });
    storeToken(result.deviceToken);
    return result;
  },

  pairedDevices: () =>
    liveOrEmpty<PairedDevicesResponse>(
      (base) => apiRequest<PairedDevicesResponse>(base, '/pair/devices'),
      () => ({ devices: [] }),
    ),

  /** Revoking a device requires kiosk scope — see toggleService's note above. */
  revokeDevice: (deviceId: string) => {
    if (!connection.nodeBaseUrl) {
      throw new ApiRequestError('No node connection.');
    }
    return apiRequest<{ ok: boolean }>(connection.nodeBaseUrl, `/pair/devices/${deviceId}`, {
      method: 'DELETE',
    });
  },
};
