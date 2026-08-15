/**
 * Gate^Flame — gateflameApi tests.
 *
 * This module is the seam: one facade, either a real node or the simulator
 * underneath, and the caller is always told which. The tests below drive it
 * through a stubbed `fetch` rather than by mocking nodeDiscovery, so the real
 * discovery race, the real apiClient error classification and the real fallback
 * all participate. Mocking discovery would leave the actual decision — "did
 * anything answer?" — untested.
 *
 * The property that matters is not "demo mode works". It is that demo mode is
 * never indistinguishable from live: every fallback must also move
 * `dataSource` to 'demo' and notify subscribers, because that flag is the only
 * thing standing between a user and fabricated security telemetry presented as
 * their own network.
 *
 * `connection` is module-level state and `config` freezes import.meta.env at
 * import time, so every test loads a fresh copy of the module graph.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_TELEMETRY } from '../data/mockData';
import type { ConnectionState, NodeStatusResponse } from '../types/api';

const NODE_STATUS: NodeStatusResponse = {
  nodeId: 'gf-node-008',
  nodeName: 'Gate^Flame Primary Node #008',
  agentVersion: '1.4.2',
  uptimeSeconds: 86420,
  protectionStatus: 'active',
  filterLevel: 'high',
  piholeReachable: true,
  host: { cpuPercent: 11, memUsedMB: 480, memTotalMB: 2048, diskUsedPercent: 34 },
};

const LIVE_SUMMARY = {
  totalQueriesToday: 111,
  queriesBlockedToday: 22,
  blockPercentage: 19.8,
  domainsOnGravity: 1_000_000,
  activeClientsCount: 3,
  dataSavedMB: 7.5,
  avgLatencyMs: 2.2,
  uptimeSeconds: 500,
  protectionStatus: 'active' as const,
  filterLevel: 'high' as const,
  pauseTimeRemainingSeconds: 0,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A node that answers status, plus whatever extra routes a test needs. */
const nodeAt = (
  baseUrl: string,
  routes: Record<string, () => Response | Promise<Response>> = {},
) =>
  vi.fn(async (url: string) => {
    if (!url.startsWith(baseUrl)) throw new TypeError('Failed to fetch');
    const path = url.slice(`${baseUrl}/api/v1`.length);
    if (path === '/system/status') return json(NODE_STATUS);
    const route = Object.entries(routes).find(([p]) => path.startsWith(p));
    if (route) return route[1]();
    throw new TypeError('Failed to fetch');
  });

/** Nothing on the network answers at all. */
const deadNetwork = () =>
  vi.fn(async () => {
    throw new TypeError('Failed to fetch');
  });

/** Fresh module graph, so `connection` and `config` start clean. */
const loadApi = async () => {
  vi.resetModules();
  return import('./gateflameApi');
};

describe('gateflameApi — the live/demo decision', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('a reachable node yields live data', () => {
    it('connect() resolves to live and records the node identity from /system/status', async () => {
      vi.stubGlobal('fetch', nodeAt('http://gateflame.local'));
      const { gateflameApi } = await loadApi();

      const state = await gateflameApi.connect();

      expect(state.dataSource).toBe('live');
      expect(state.nodeBaseUrl).toBe('http://gateflame.local');
      expect(state.nodeId).toBe(NODE_STATUS.nodeId);
      expect(state.nodeName).toBe(NODE_STATUS.nodeName);
      expect(state.agentVersion).toBe(NODE_STATUS.agentVersion);
      expect(state.lastError).toBeNull();
      expect(state.lastSuccessAt).not.toBeNull();
      expect(state.mockForced).toBe(false);
    });

    it('telemetry() returns the node’s numbers, not the simulator’s', async () => {
      vi.stubGlobal(
        'fetch',
        nodeAt('http://gateflame.local', { '/telemetry/summary': () => json(LIVE_SUMMARY) }),
      );
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();

      const summary = await gateflameApi.telemetry(INITIAL_TELEMETRY);

      expect(summary).toEqual(LIVE_SUMMARY);
      // The simulator would have walked up from the seed values instead.
      expect(summary.totalQueriesToday).toBeLessThan(INITIAL_TELEMETRY.totalQueriesToday);
      expect(gateflameApi.getConnection().dataSource).toBe('live');
    });

    it('threats() and clients() come from the node while live', async () => {
      const entries = [
        {
          id: 'live-1',
          timestamp: '10:00:00',
          domain: 'real.tracker.example',
          clientIp: '10.0.0.9',
          clientName: 'Real Client',
          category: 'Ad Tracker',
          action: 'Blocked',
          severity: 'high',
        },
      ];
      vi.stubGlobal(
        'fetch',
        nodeAt('http://gateflame.local', {
          '/threats/recent': () => json({ entries, total: 1 }),
          '/clients': () => json({ clients: [] }),
        }),
      );
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();

      await expect(gateflameApi.threats(20)).resolves.toEqual({ entries, total: 1 });
      // An empty live client list must be reported as empty, not backfilled
      // with the seeded mock clients.
      await expect(gateflameApi.clients()).resolves.toEqual({ clients: [] });
    });

    it('a node discovered on a LAN address is remembered for next launch', async () => {
      // Carries :8080 deliberately. The agent binds GATEFLAME_PORT (default
      // 8080); a candidate without a port resolves to :80, where nothing
      // listens, which is exactly the bug this address shape now guards.
      vi.stubGlobal('fetch', nodeAt('http://192.168.1.105:8080'));
      const { gateflameApi } = await loadApi();

      await gateflameApi.connect();

      expect(gateflameApi.getConnection().nodeBaseUrl).toBe('http://192.168.1.105:8080');
      expect(localStorage.getItem('gateflame-last-node-url')).toBe('http://192.168.1.105:8080');
    });

    it('every LAN discovery candidate names the port the agent actually binds', async () => {
      // Regression guard for the defect that made a phone unable to find a node
      // on any real network: six of eight candidates omitted :8080.
      const { config } = await import('../config/env');
      const lan = config.discoveryCandidates.filter((u) => !u.includes('localhost') && !u.includes('127.0.0.1'));
      const withPort = lan.filter((u) => /:\d+$/.test(u));
      expect(withPort.length).toBeGreaterThanOrEqual(lan.length - 1);
      expect(config.discoveryCandidates).toContain('http://gateflame.local:8080');
    });
  });

  describe('an unreachable node falls back to the simulator AND reports demo mode', () => {
    it('connect() lands on demo with a human-readable reason and mockForced false', async () => {
      vi.stubGlobal('fetch', deadNetwork());
      const { gateflameApi } = await loadApi();

      const state = await gateflameApi.connect();

      expect(state.dataSource).toBe('demo');
      expect(state.nodeBaseUrl).toBeNull();
      expect(state.nodeId).toBeNull();
      // mockForced distinguishes "we failed" from "someone switched demo on",
      // and DataSourceBanner shows different copy for each.
      expect(state.mockForced).toBe(false);
      expect(state.lastError).toMatch(/No Gate\^Flame node found on this network/);
    });

    it('telemetry() returns simulated numbers derived from the previous tick', async () => {
      vi.stubGlobal('fetch', deadNetwork());
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();

      const summary = await gateflameApi.telemetry(INITIAL_TELEMETRY);

      // The simulator advances from what it was given, so the value is above the
      // seed but only just — that is what tells it apart from LIVE_SUMMARY.
      expect(summary.totalQueriesToday).toBeGreaterThan(INITIAL_TELEMETRY.totalQueriesToday);
      expect(summary.totalQueriesToday).toBeLessThanOrEqual(
        INITIAL_TELEMETRY.totalQueriesToday + 4,
      );
      expect(summary.uptimeSeconds).toBe(INITIAL_TELEMETRY.uptimeSeconds + 4);
      // And it is still, unmistakably, demo.
      expect(gateflameApi.getConnection().dataSource).toBe('demo');
    });

    it('notifies subscribers of the demo state, which is what raises the banner', async () => {
      vi.stubGlobal('fetch', deadNetwork());
      const { gateflameApi } = await loadApi();

      const seen: ConnectionState['dataSource'][] = [];
      const unsubscribe = gateflameApi.subscribeConnection((s) => seen.push(s.dataSource));

      await gateflameApi.connect();

      // Immediate current value, then connecting, then the fallback.
      expect(seen[0]).toBe('connecting');
      expect(seen).toContain('connecting');
      expect(seen[seen.length - 1]).toBe('demo');

      unsubscribe();
      await gateflameApi.connect();
      expect(seen[seen.length - 1]).toBe('demo');
      expect(seen.filter((s) => s === 'demo')).toHaveLength(1);
    });

    it('does not reach the network more than the candidate list allows', async () => {
      const fetchMock = deadNetwork();
      vi.stubGlobal('fetch', fetchMock);
      const { gateflameApi } = await loadApi();

      await gateflameApi.connect();
      // Discovery races the candidates concurrently rather than probing serially,
      // and must not retry them: one attempt per candidate.
      const { config } = await import('../config/env');
      expect(fetchMock).toHaveBeenCalledTimes(config.discoveryCandidates.length);
    });
  });

  describe('losing the node mid-session', () => {
    it('degrades from live to demo, keeps rendering, and says why', async () => {
      let telemetryReachable = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/system/status')) return json(NODE_STATUS);
          if (url.endsWith('/telemetry/summary')) {
            if (!telemetryReachable) throw new TypeError('Failed to fetch');
            return json(LIVE_SUMMARY);
          }
          throw new TypeError('Failed to fetch');
        }),
      );
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();
      await expect(gateflameApi.telemetry(INITIAL_TELEMETRY)).resolves.toEqual(LIVE_SUMMARY);

      telemetryReachable = false;
      const afterLoss = await gateflameApi.telemetry(INITIAL_TELEMETRY);

      // Simulated data rather than a blank dashboard...
      expect(afterLoss.totalQueriesToday).toBeGreaterThan(INITIAL_TELEMETRY.totalQueriesToday);
      // ...but flagged, with the reason, and the base URL dropped.
      const state = gateflameApi.getConnection();
      expect(state.dataSource).toBe('demo');
      expect(state.nodeBaseUrl).toBeNull();
      expect(state.lastError).toMatch(/^Lost contact with the node:/);
    });

    it('a node that answers and refuses surfaces the refusal and stays live', async () => {
      vi.stubGlobal(
        'fetch',
        nodeAt('http://gateflame.local', {
          '/telemetry/summary': () => json({ error: 'forbidden', message: 'token revoked' }, 403),
        }),
      );
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();

      await expect(gateflameApi.telemetry(INITIAL_TELEMETRY)).rejects.toThrow('token revoked');
      // Critically: no fallback. A 403 is a real answer, and papering over it
      // with fabricated numbers would hide a revoked pairing.
      expect(gateflameApi.getConnection().dataSource).toBe('live');
    });
  });

  describe('something else answering on a candidate address', () => {
    it('is rejected rather than treated as a node', async () => {
      // A captive portal or an unrelated web server returning 200.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => json({ hello: 'this is a router admin page' })),
      );
      const { gateflameApi } = await loadApi();

      const state = await gateflameApi.connect();

      expect(state.dataSource).toBe('demo');
      expect(state.nodeBaseUrl).toBeNull();
    });
  });

  describe('VITE_USE_MOCK_DATA=true (forced demo)', () => {
    it('goes straight to demo with mockForced set and never probes the network', async () => {
      vi.stubEnv('VITE_USE_MOCK_DATA', 'true');
      const fetchMock = nodeAt('http://gateflame.local');
      vi.stubGlobal('fetch', fetchMock);
      const { gateflameApi } = await loadApi();

      const state = await gateflameApi.connect();

      expect(state.dataSource).toBe('demo');
      expect(state.mockForced).toBe(true);
      expect(state.lastError).toBeNull();
      // Even with a node sitting right there.
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('VITE_STRICT_LIVE=true (no silent fallback)', () => {
    it('reports error instead of demo when nothing answers', async () => {
      vi.stubEnv('VITE_STRICT_LIVE', 'true');
      vi.stubGlobal('fetch', deadNetwork());
      const { gateflameApi } = await loadApi();

      const state = await gateflameApi.connect();

      expect(state.dataSource).toBe('error');
      expect(state.lastError).toMatch(/No Gate\^Flame node found/);
    });

    it('throws from data calls rather than returning fabricated numbers', async () => {
      vi.stubEnv('VITE_STRICT_LIVE', 'true');
      vi.stubGlobal('fetch', deadNetwork());
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();

      await expect(gateflameApi.telemetry(INITIAL_TELEMETRY)).rejects.toThrow(
        /No Gate\^Flame node found/,
      );
    });

    it('surfaces a mid-session loss as an error instead of dropping to demo', async () => {
      vi.stubEnv('VITE_STRICT_LIVE', 'true');
      let reachable = true;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (url.endsWith('/system/status')) return json(NODE_STATUS);
          if (url.endsWith('/telemetry/summary') && reachable) return json(LIVE_SUMMARY);
          throw new TypeError('Failed to fetch');
        }),
      );
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();
      await gateflameApi.telemetry(INITIAL_TELEMETRY);

      reachable = false;
      await expect(gateflameApi.telemetry(INITIAL_TELEMETRY)).rejects.toThrow(/Failed to fetch/);
      expect(gateflameApi.getConnection().dataSource).toBe('error');
    });
  });

  describe('pairing has no simulated fallback', () => {
    it('requestPairingCode refuses without a node rather than inventing a code', async () => {
      vi.stubGlobal('fetch', deadNetwork());
      const { gateflameApi } = await loadApi();
      await gateflameApi.connect();

      expect(() => gateflameApi.requestPairingCode()).toThrow(/must be live to issue a pairing code/);
    });

    it('claimPairingCode stores the returned device token', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({
            deviceToken: 'tok-xyz',
            nodeId: NODE_STATUS.nodeId,
            nodeName: NODE_STATUS.nodeName,
            scopes: ['read', 'control'],
          }),
        ),
      );
      const { gateflameApi } = await loadApi();
      const { config } = await import('../config/env');

      const result = await gateflameApi.claimPairingCode(
        'http://gateflame.local',
        '123456',
        'Dennis iPhone',
      );

      expect(result.deviceToken).toBe('tok-xyz');
      expect(localStorage.getItem(config.tokenStorageKey)).toBe('tok-xyz');
    });
  });
});
