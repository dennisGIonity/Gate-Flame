/**
 * Gate^Flame — the seam.
 *
 * One facade the UI calls. Underneath it is either the real node or the
 * simulator, and the caller is always told which. This is the single place
 * where that decision is made.
 *
 * Resolution order:
 *   1. VITE_USE_MOCK_DATA=true  → demo, flagged as forced.
 *   2. A node answers discovery  → live.
 *   3. VITE_STRICT_LIVE=true     → error. No silent fallback.
 *   4. Otherwise                 → demo, flagged with the reason.
 *
 * Step 3 exists so QA cannot mistake a broken API for a working one: in strict
 * mode a failure shows as a failure rather than as plausible fabricated data.
 */

import { config } from '../config/env';
import { apiRequest, ApiRequestError, storeToken } from './apiClient';
import { discoverNode } from './nodeDiscovery';
import { mockAdapter } from './mockAdapter';
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

let connection: ConnectionState = {
  dataSource: 'connecting',
  nodeBaseUrl: null,
  nodeId: null,
  nodeName: null,
  agentVersion: null,
  lastError: null,
  lastSuccessAt: null,
  mockForced: false,
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
  if (config.forceMockData) {
    setConnection({
      dataSource: 'demo',
      mockForced: true,
      nodeBaseUrl: null,
      lastError: null,
    });
    return connection;
  }

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
      mockForced: false,
    });
  } catch (err) {
    const reason =
      err instanceof ApiRequestError
        ? err.message
        : 'Could not reach a Gate^Flame node on this network.';

    setConnection({
      dataSource: config.strictLive ? 'error' : 'demo',
      nodeBaseUrl: null,
      nodeId: null,
      nodeName: null,
      agentVersion: null,
      lastError: reason,
      mockForced: false,
    });
  }

  return connection;
}

/**
 * Run a live call, and on unreachability drop to demo rather than throwing at
 * the UI. A node that goes offline mid-session must degrade visibly, not blank
 * the dashboard.
 */
async function liveOrFallback<T>(call: (baseUrl: string) => Promise<T>, fallback: () => T): Promise<T> {
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
          dataSource: 'demo',
          nodeBaseUrl: null,
          lastError: `Lost contact with the node: ${err.message}`,
        });
        return fallback();
      }
      // The node answered and refused. That is a real answer — surface it.
      throw err;
    }
  }

  if (connection.dataSource === 'error') {
    throw new ApiRequestError(connection.lastError ?? 'Not connected to a node');
  }

  return fallback();
}

export const gateflameApi = {
  connect,
  getConnection,
  subscribeConnection,

  telemetry: (prev: Parameters<typeof mockAdapter.telemetryTick>[0]) =>
    liveOrFallback<TelemetrySummaryResponse>(
      (base) => apiRequest<TelemetrySummaryResponse>(base, '/telemetry/summary'),
      () => mockAdapter.telemetryTick(prev),
    ),

  threats: (limit = 20) =>
    liveOrFallback<ThreatLogResponse>(
      (base) => apiRequest<ThreatLogResponse>(base, `/threats/recent?limit=${limit}`),
      () => mockAdapter.threats(),
    ),

  clients: () =>
    liveOrFallback<ClientsResponse>(
      (base) => apiRequest<ClientsResponse>(base, '/clients'),
      () => mockAdapter.clients(),
    ),

  services: () =>
    liveOrFallback<ServicesResponse>(
      (base) => apiRequest<ServicesResponse>(base, '/services'),
      () => mockAdapter.services(),
    ),

  moduleMetrics: (moduleId: string) =>
    liveOrFallback<ModuleMetricsResponse>(
      (base) => apiRequest<ModuleMetricsResponse>(base, `/modules/${moduleId}/metrics`),
      () => mockAdapter.moduleMetrics(moduleId),
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
  toggleService: (moduleId: string, slug: string, enable: boolean) =>
    liveOrFallback<ServiceActionResponse>(
      (base) =>
        apiRequest<ServiceActionResponse>(base, `/services/${slug}/${enable ? 'start' : 'stop'}`, {
          method: 'POST',
        }),
      () => mockAdapter.toggleService(moduleId, enable),
    ),

  /**
   * Pairing has no demo fallback — either a real node answers, or the screen
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
    liveOrFallback<PairedDevicesResponse>(
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
