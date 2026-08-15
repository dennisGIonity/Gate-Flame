/**
 * Gate^Flame — the telemetry loop.
 *
 * Polls the node for real telemetry and threat activity. When no node is
 * reachable, `gateflameApi` routes to the simulator and flips the connection
 * state to `demo`, which is what makes DataSourceBanner appear. This loop does
 * not know which of the two it got — that decision lives in one place.
 *
 * What this replaced: a `setInterval(4000)` fabricating query counts, block
 * percentages, saved-megabytes and threat-log rows from `Math.random()` over
 * six hardcoded domains, with nothing anywhere indicating it was fiction.
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { gateflameApi } from '../services/gateflameApi';
import { mockAdapter } from '../services/mockAdapter';
import { config } from '../config/env';
import { ApiRequestError } from '../services/apiClient';
import type { SystemTelemetry } from '../types';

export const useGateFlameEngine = () => {
  const setTelemetry = useAppStore((s) => s.setTelemetry);
  const setThreatLogs = useAppStore((s) => s.setThreatLogs);
  const setClients = useAppStore((s) => s.setClients);

  // Read telemetry through a ref so the interval does not tear down and rebuild
  // on every tick. The previous implementation listed telemetry fields in its
  // dependency array, so the timer it had just created was cleared and replaced
  // four seconds later, every time, forever.
  const telemetryRef = useRef<SystemTelemetry>(useAppStore.getState().telemetry);
  useEffect(
    () =>
      useAppStore.subscribe((s) => {
        telemetryRef.current = s.telemetry;
      }),
    [],
  );

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setInterval> | undefined;
    let inFlight = false;

    const tick = async () => {
      // Skip if the previous poll has not returned. On a slow or flapping LAN
      // this otherwise stacks requests until the node is the bottleneck.
      if (inFlight || abort.signal.aborted) return;

      const current = telemetryRef.current;
      if (current.protectionStatus !== 'active') return;

      inFlight = true;
      try {
        const summary = await gateflameApi.telemetry(current);
        if (abort.signal.aborted) return;

        setTelemetry((prev) => ({
          ...prev,
          totalQueriesToday: summary.totalQueriesToday,
          queriesBlockedToday: summary.queriesBlockedToday,
          blockPercentage: summary.blockPercentage,
          domainsOnGravity: summary.domainsOnGravity,
          activeClientsCount: summary.activeClientsCount,
          dataSavedMB: summary.dataSavedMB,
          avgLatencyMs: summary.avgLatencyMs,
          uptimeSeconds: summary.uptimeSeconds,
        }));

        const source = gateflameApi.getConnection().dataSource;

        if (source === 'live') {
          // The node owns the threat log and the client list. Never synthesise
          // entries over them, and never leave the seeded placeholders in
          // place once real data is available — a stale mock client list beside
          // live telemetry is the worst of both.
          const [threats, clientList] = await Promise.all([
            gateflameApi.threats(20),
            gateflameApi.clients(),
          ]);
          if (abort.signal.aborted) return;
          setThreatLogs(threats.entries);
          setClients(clientList.clients);
        } else if (source === 'demo') {
          const fabricated = mockAdapter.threatTick(current.filterLevel);
          if (fabricated) {
            setThreatLogs((prev) => [fabricated, ...prev.slice(0, 19)]);
          }
        }
      } catch (err) {
        // Only genuine refusals reach here — unreachability is handled inside
        // gateflameApi by falling back and flipping the banner.
        if (!(err instanceof ApiRequestError)) throw err;
        console.warn('[gateflame] telemetry poll rejected:', err.message);
      } finally {
        inFlight = false;
      }
    };

    // Establish the data source first, then start polling.
    void gateflameApi.connect(abort.signal).then(() => {
      if (abort.signal.aborted) return;
      void tick();
      timer = setInterval(() => void tick(), config.pollIntervalMs);
    });

    return () => {
      abort.abort();
      if (timer) clearInterval(timer);
    };
    // Deps are the three store setters and nothing else.
    //
    // `useAppStore.getState().telemetry.totalQueriesToday` sat in this array
    // until 2026-08-14, which defeated the whole point of the telemetryRef
    // above: totalQueriesToday changes on every successful poll, so the effect
    // re-ran on every tick — aborting its own AbortController, clearing the
    // interval it had just created, building a new one, and calling
    // gateflameApi.connect() again. On real hardware that is a fresh discovery
    // handshake against the node every four seconds, forever.
    //
    // Zustand setters are stable references, so this array never changes and
    // the loop is built exactly once per mount. Anything a tick needs to READ
    // from the store goes through telemetryRef — never through a dependency.
  }, [setTelemetry, setThreatLogs, setClients]);
};
