/**
 * Gate^Flame — useGateFlameEngine tests.
 *
 * This hook is the app's only telemetry loop, and every property tested here
 * corresponds to a way the previous implementation was broken:
 *
 *  - it listed telemetry fields in its effect dependency array, so the interval
 *    it had just created was torn down and rebuilt on every single tick;
 *  - it had no in-flight guard, so a slow or flapping LAN stacked requests until
 *    the node itself became the bottleneck;
 *  - it had no AbortController, so a poll that returned after unmount still
 *    wrote to the store.
 *
 * All three are invisible in a working demo and only bite on real hardware, so
 * they are asserted directly rather than through the UI.
 *
 * `gateflameApi` is mocked: what is under test is the loop's scheduling and
 * lifecycle, not the live/offline decision — that has its own suite in
 * src/services/gateflameApi.test.ts.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_TELEMETRY } from '../data/seeds';
import { config } from '../config/env';
import { useAppStore } from '../store/useAppStore';
import { ApiRequestError } from '../services/apiClient';
import { useGateFlameEngine } from './useGateFlameEngine';
import { gateflameApi } from '../services/gateflameApi';
import type { ThreatLogEntry } from '../types';
import type { TelemetrySummaryResponse } from '../types/api';

vi.mock('../services/gateflameApi', () => ({
  gateflameApi: {
    connect: vi.fn(),
    getConnection: vi.fn(),
    telemetry: vi.fn(),
    threats: vi.fn(),
    clients: vi.fn(),
  },
}));

const api = vi.mocked(gateflameApi);

/** A seed with a measured starting count so "+10 per tick" can be asserted. */
const INITIAL_TELEMETRY = { ...EMPTY_TELEMETRY, totalQueriesToday: 1000, protectionStatus: 'active' as const };
const SEED_LOG: ThreatLogEntry = {
  id: 'seed-1',
  timestamp: '09:00:00',
  domain: 'seed.example',
  clientIp: '10.0.0.1',
  clientName: 'Seed',
  category: 'Telemetry',
  action: 'Blocked',
  severity: 'low',
};

const summary = (n: number): TelemetrySummaryResponse => ({
  totalQueriesToday: n,
  queriesBlockedToday: Math.floor(n / 2),
  blockPercentage: 50,
  domainsOnGravity: 1234,
  activeClientsCount: 2,
  dataSavedMB: 1.5,
  avgLatencyMs: 3,
  uptimeSeconds: n,
  protectionStatus: 'active',
  filterLevel: 'high',
  pauseTimeRemainingSeconds: 0,
});

const connectionState = (dataSource: 'live' | 'offline') =>
  ({
    dataSource,
    nodeBaseUrl: dataSource === 'live' ? 'http://gateflame.local' : null,
    nodeId: null,
    nodeName: null,
    agentVersion: null,
    lastError: null,
    lastSuccessAt: null,
  }) as ReturnType<typeof gateflameApi.getConnection>;

/** Render the hook and let connect() settle plus the first immediate tick run. */
const start = async () => {
  const view = renderHook(() => useGateFlameEngine());
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
};

/** Advance exactly one poll interval and flush the resulting promises. */
const oneInterval = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(config.pollIntervalMs);
  });
};

describe('useGateFlameEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState({
      telemetry: { ...INITIAL_TELEMETRY },
      threatLogs: [SEED_LOG],
      clients: [],
      activeModules: [],
    });
    localStorage.clear();

    api.connect.mockResolvedValue(connectionState('offline'));
    api.getConnection.mockReturnValue(connectionState('offline'));
    api.telemetry.mockImplementation(async () =>
      summary((useAppStore.getState().telemetry.totalQueriesToday ?? 0) + 10),
    );
    api.threats.mockResolvedValue({ entries: [], total: 0 });
    api.clients.mockResolvedValue({ clients: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('polling', () => {
    it('establishes the data source before polling, then polls immediately', async () => {
      await start();

      expect(api.connect).toHaveBeenCalledTimes(1);
      expect(api.telemetry).toHaveBeenCalledTimes(1);
      // connect() resolved first: the first tick already knows live from offline.
      expect(api.connect.mock.invocationCallOrder[0]).toBeLessThan(
        api.telemetry.mock.invocationCallOrder[0],
      );
    });

    it('does not poll at all if connect() has not resolved yet', async () => {
      let release = () => {};
      api.connect.mockReturnValue(
        new Promise((resolve) => {
          release = () => resolve(connectionState('offline'));
        }),
      );

      renderHook(() => useGateFlameEngine());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 3);
      });
      expect(api.telemetry).not.toHaveBeenCalled();

      await act(async () => {
        release();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(api.telemetry).toHaveBeenCalledTimes(1);
    });

    it('keeps polling once per interval', async () => {
      await start();

      await oneInterval();
      expect(api.telemetry).toHaveBeenCalledTimes(2);
      await oneInterval();
      await oneInterval();
      expect(api.telemetry).toHaveBeenCalledTimes(4);
    });

    it('writes the polled summary into the store, field by field', async () => {
      api.telemetry.mockResolvedValue(summary(999));

      await start();

      const t = useAppStore.getState().telemetry;
      expect(t.totalQueriesToday).toBe(999);
      expect(t.queriesBlockedToday).toBe(499);
      expect(t.uptimeSeconds).toBe(999);
      // Fields the summary does not own are left alone — pause state is local.
      expect(t.pauseTimeRemainingSeconds).toBe(INITIAL_TELEMETRY.pauseTimeRemainingSeconds);
    });

    it('stops polling while protection is paused, and resumes when it is not', async () => {
      await start();
      expect(api.telemetry).toHaveBeenCalledTimes(1);

      act(() => {
        useAppStore.getState().pauseProtection(10);
      });
      await oneInterval();
      await oneInterval();
      // The timer still fires; the tick declines to do anything.
      expect(api.telemetry).toHaveBeenCalledTimes(1);

      act(() => {
        useAppStore.getState().resumeProtection();
      });
      await oneInterval();
      expect(api.telemetry).toHaveBeenCalledTimes(2);
    });

    it('passes the CURRENT telemetry to each poll rather than the value at mount', async () => {
      await start();

      act(() => {
        useAppStore.getState().changeFilterLevel('low');
      });
      await oneInterval();

      const lastArg = api.telemetry.mock.calls.at(-1)?.[0];
      expect(lastArg?.filterLevel).toBe('low');
    });

    it('polls while the seed state is still initializing — that is how it leaves it', async () => {
      useAppStore.setState({ telemetry: { ...EMPTY_TELEMETRY } });
      await start();
      expect(api.telemetry).toHaveBeenCalledTimes(1);
    });
  });

  describe('overlapping polls are skipped', () => {
    it('does not start a second poll while the first is still outstanding', async () => {
      // A node on a flapping LAN: this request simply never comes back.
      api.telemetry.mockReturnValue(new Promise<TelemetrySummaryResponse>(() => {}));

      await start();
      expect(api.telemetry).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 10);
      });

      // Ten interval firings later, still exactly one request in flight.
      expect(api.telemetry).toHaveBeenCalledTimes(1);
    });

    it('resumes polling on the next interval after the stuck request settles', async () => {
      let settle: (s: TelemetrySummaryResponse) => void = () => {};
      api.telemetry.mockReturnValueOnce(
        new Promise<TelemetrySummaryResponse>((resolve) => {
          settle = resolve;
        }),
      );

      await start();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 3);
      });
      expect(api.telemetry).toHaveBeenCalledTimes(1);

      await act(async () => {
        settle(summary(50));
        await vi.advanceTimersByTimeAsync(0);
      });
      // The stuck response is still applied once it arrives.
      expect(useAppStore.getState().telemetry.totalQueriesToday).toBe(50);

      await oneInterval();

      expect(api.telemetry).toHaveBeenCalledTimes(2);
      // And the loop is running again: the next tick advances from 50.
      expect(useAppStore.getState().telemetry.totalQueriesToday).toBe(60);
    });

    it('clears the in-flight flag even when a poll rejects', async () => {
      api.telemetry.mockRejectedValueOnce(new ApiRequestError('node said no', { status: 403 }));
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await start();
      await oneInterval();

      // A rejected poll must not wedge the loop shut.
      expect(api.telemetry).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(
        '[gateflame] telemetry poll rejected:',
        'node said no',
      );
      warn.mockRestore();
    });
  });

  describe('interval stability', () => {
    it('creates exactly one interval and never rebuilds it as telemetry changes', async () => {
      // Count setInterval/clearInterval calls rather than vi.getTimerCount():
      // the fake clock also holds timers React and jsdom schedule for their own
      // reasons, so a raw count is 2 even when the hook owns exactly one.
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

      // App.tsx and main-mobile.tsx both call the hook from a component that
      // also does `useAppStore()` — an unselected subscription — so the host
      // component re-renders on every single poll. That is the condition under
      // which the old dependency array tore the timer down and rebuilt it, and
      // it has to be reproduced here or the test proves nothing.
      let renders = 0;
      const view = renderHook(() => {
        renders += 1;
        useGateFlameEngine();
        return useAppStore((s) => s.telemetry.totalQueriesToday);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      for (let i = 0; i < 5; i += 1) await oneInterval();

      expect(api.telemetry).toHaveBeenCalledTimes(6);
      expect(useAppStore.getState().telemetry.totalQueriesToday).toBe(
        INITIAL_TELEMETRY.totalQueriesToday + 60,
      );
      // The host really did re-render on each tick...
      expect(renders).toBeGreaterThan(6);
      expect(view.result.current).toBe(INITIAL_TELEMETRY.totalQueriesToday + 60);
      // ...and the loop was still built exactly once. Before the 2026-08-14 fix
      // this was 6: totalQueriesToday was in the effect's dependency array, so
      // every tick tore the interval down and rebuilt it — and re-ran
      // gateflameApi.connect() with it.
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).not.toHaveBeenCalled();

      view.unmount();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('re-renders from unrelated state do not restart the loop', async () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const view = renderHook(() => {
        useGateFlameEngine();
        return useAppStore((s) => s.userAccount.appTheme);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      act(() => {
        useAppStore.getState().updateUserAccount({ appTheme: 'dark' });
      });
      view.rerender();

      expect(view.result.current).toBe('dark');
      expect(api.connect).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      setIntervalSpy.mockRestore();
    });
  });

  describe('abort on unmount', () => {
    it('passes an AbortSignal to connect() and aborts it when unmounted', async () => {
      const view = await start();

      const signal = api.connect.mock.calls[0][0] as AbortSignal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);

      view.unmount();
      expect(signal.aborted).toBe(true);
    });

    it('stops polling after unmount', async () => {
      const view = await start();
      expect(api.telemetry).toHaveBeenCalledTimes(1);

      view.unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(config.pollIntervalMs * 5);
      });

      expect(api.telemetry).toHaveBeenCalledTimes(1);
    });

    it('discards the result of a poll that returns after unmount', async () => {
      let settle: (s: TelemetrySummaryResponse) => void = () => {};
      api.telemetry.mockReturnValue(
        new Promise<TelemetrySummaryResponse>((resolve) => {
          settle = resolve;
        }),
      );

      const view = await start();
      const before = useAppStore.getState().telemetry.totalQueriesToday;

      view.unmount();
      await act(async () => {
        settle(summary(4242));
        await vi.advanceTimersByTimeAsync(0);
      });

      // Writing here would be a state update on an unmounted tree, and worse,
      // would resurrect data the user has navigated away from.
      expect(useAppStore.getState().telemetry.totalQueriesToday).toBe(before);
    });

    it('does not fetch threats or clients if unmounted between the two calls', async () => {
      api.getConnection.mockReturnValue(connectionState('live'));
      let settleThreats: (r: { entries: ThreatLogEntry[]; total: number }) => void = () => {};
      api.threats.mockReturnValue(
        new Promise((resolve) => {
          settleThreats = resolve;
        }),
      );
      const liveEntry: ThreatLogEntry = {
        id: 'live-1',
        timestamp: '10:00:00',
        domain: 'tracker.example',
        clientIp: '10.0.0.2',
        clientName: 'Laptop',
        category: 'Ad Tracker',
        action: 'Blocked',
        severity: 'high',
      };

      const view = await start();
      view.unmount();

      await act(async () => {
        settleThreats({ entries: [liveEntry], total: 1 });
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(useAppStore.getState().threatLogs).not.toContainEqual(liveEntry);
    });
  });

  describe('live versus offline handling inside a tick', () => {
    const liveEntry: ThreatLogEntry = {
      id: 'live-1',
      timestamp: '10:00:00',
      domain: 'tracker.example',
      clientIp: '10.0.0.2',
      clientName: 'Laptop',
      category: 'Ad Tracker',
      action: 'Blocked',
      severity: 'high',
    };

    it('replaces threat logs and clients wholesale from the node when live', async () => {
      api.getConnection.mockReturnValue(connectionState('live'));
      api.threats.mockResolvedValue({ entries: [liveEntry], total: 1 });
      api.clients.mockResolvedValue({ clients: [] });

      await start();

      // The seed row is gone — nothing sits beside live telemetry that the
      // node did not send.
      expect(useAppStore.getState().threatLogs).toEqual([liveEntry]);
      expect(useAppStore.getState().clients).toEqual([]);
      expect(api.threats).toHaveBeenCalledWith(20);
    });

    it('offline: fetches nothing and adds nothing to the lists', async () => {
      api.getConnection.mockReturnValue(connectionState('offline'));
      const before = useAppStore.getState().threatLogs;

      await start();
      await oneInterval();
      await oneInterval();

      // Three ticks offline: the log is byte-for-byte what it was. No row was
      // synthesised, because there is no code left that could synthesise one.
      expect(useAppStore.getState().threatLogs).toEqual(before);
      expect(api.threats).not.toHaveBeenCalled();
      expect(api.clients).not.toHaveBeenCalled();
    });

    it('offline: an all-null summary is written as-is, not backfilled', async () => {
      api.getConnection.mockReturnValue(connectionState('offline'));
      api.telemetry.mockResolvedValue({
        ...summary(0),
        totalQueriesToday: null,
        queriesBlockedToday: null,
        blockPercentage: null,
        domainsOnGravity: null,
        activeClientsCount: null,
        dataSavedMB: null,
        avgLatencyMs: null,
      });

      await start();

      const t = useAppStore.getState().telemetry;
      expect(t.totalQueriesToday).toBeNull();
      expect(t.domainsOnGravity).toBeNull();
    });
  });
});
