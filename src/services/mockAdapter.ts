/**
 * Gate^Flame — simulated node.
 *
 * ⚠ EVERYTHING IN THIS FILE IS FICTION.
 *
 * This is the demo surface: it lets the product be shown without a Pi on the
 * table. It is quarantined here, behind one flag, for a specific reason —
 * previously the simulation was scattered through useGateFlameEngine.ts,
 * DynamicModuleTab.tsx and useAppStore.ts with no marker, so every green light
 * in the product was fabricated and nothing said so.
 *
 * Two rules govern this file:
 *
 *   1. Nothing here is ever reachable while `dataSource === 'live'`.
 *   2. Whenever it *is* reachable, the UI says so — DataSourceBanner is
 *      rendered and every module card carries a SIMULATED badge. A user must
 *      never be unable to tell which of the two they are looking at.
 *
 * Rule 2 is not decoration. Shipping fabricated security telemetry that looks
 * identical to real telemetry is the difference between a demo and a lie.
 */

// From the leaf module, NOT serviceManager — see securityModules.ts for why.
import { SECURITY_MODULES } from './securityModules';
import {
  INITIAL_TELEMETRY,
  MOCK_THREAT_LOGS,
  MOCK_CLIENTS,
} from '../data/mockData';
import type { SystemTelemetry, ThreatLogEntry } from '../types';
import type {
  ClientsResponse,
  ModuleMetricsResponse,
  ModuleState,
  ServiceActionResponse,
  ServicesResponse,
  TelemetrySummaryResponse,
  ThreatLogResponse,
} from '../types/api';

const SAMPLE_DOMAINS = [
  'telemetry.smart-tv.samsungcloud.com',
  'trackers.ads-network.io',
  'analytics.windows-telemetry.com',
  'beacon.evil-domain-phishing.xyz',
  'adservice.google.com/pagead',
  'crypto-miner.pool-hash.top',
];

const SAMPLE_CLIENTS = [
  'Living Room Smart TV 75"',
  'Dennis-MacBook-Pro',
  'Office-Workstation-04',
  'Guest-Android-Phone',
];

const CATEGORIES: ThreatLogEntry['category'][] = [
  'Telemetry',
  'Ad Tracker',
  'Phishing',
  'Cryptojacking',
  'Adult / Gambling',
];

const BLOCK_PROBABILITY: Record<SystemTelemetry['filterLevel'], number> = {
  none: 0,
  low: 0.15,
  medium: 0.37,
  high: 0.6,
};

const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

const clockString = (): string => {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
};

/** In-memory simulated module state, so toggles at least behave consistently. */
const simulatedModules = new Map<string, ModuleState>(
  SECURITY_MODULES.map((m) => [m.id, { id: m.id, status: 'stopped' as const }]),
);

export const mockAdapter = {
  /**
   * Advance the simulation one tick and return the next telemetry summary.
   * Takes the previous value so the numbers move plausibly instead of jumping.
   */
  telemetryTick(prev: SystemTelemetry): TelemetrySummaryResponse {
    const increment = Math.floor(Math.random() * 4) + 1;
    const probability = BLOCK_PROBABILITY[prev.filterLevel] ?? BLOCK_PROBABILITY.medium;
    const blockedIncrement = Math.random() < probability ? 1 : 0;

    const totalQueriesToday = prev.totalQueriesToday + increment;
    const queriesBlockedToday = prev.queriesBlockedToday + blockedIncrement;

    return {
      totalQueriesToday,
      queriesBlockedToday,
      blockPercentage: Number(((queriesBlockedToday / totalQueriesToday) * 100).toFixed(1)),
      domainsOnGravity: prev.domainsOnGravity,
      activeClientsCount: prev.activeClientsCount,
      dataSavedMB: Number((prev.dataSavedMB + blockedIncrement * 0.12).toFixed(1)),
      avgLatencyMs: prev.avgLatencyMs,
      uptimeSeconds: prev.uptimeSeconds + 4,
      protectionStatus: prev.protectionStatus,
      filterLevel: prev.filterLevel,
      pauseTimeRemainingSeconds: prev.pauseTimeRemainingSeconds,
    };
  },

  /** A fabricated block event, or null when this tick blocked nothing. */
  threatTick(filterLevel: SystemTelemetry['filterLevel']): ThreatLogEntry | null {
    const probability = BLOCK_PROBABILITY[filterLevel] ?? BLOCK_PROBABILITY.medium;
    if (Math.random() >= probability) return null;

    return {
      id: `sim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      timestamp: clockString(),
      domain: pick(SAMPLE_DOMAINS),
      clientIp: '192.168.1.112',
      clientName: pick(SAMPLE_CLIENTS),
      category: pick(CATEGORIES),
      action: 'Blocked',
      severity: filterLevel === 'high' ? 'high' : Math.random() > 0.5 ? 'high' : 'medium',
    };
  },

  initialTelemetry(): SystemTelemetry {
    return { ...INITIAL_TELEMETRY };
  },

  threats(): ThreatLogResponse {
    return { entries: [...MOCK_THREAT_LOGS], total: MOCK_THREAT_LOGS.length };
  },

  clients(): ClientsResponse {
    return { clients: [...MOCK_CLIENTS] };
  },

  services(): ServicesResponse {
    return { modules: [...simulatedModules.values()] };
  },

  toggleService(moduleId: string, enable: boolean): ServiceActionResponse {
    const next: ModuleState = {
      id: moduleId,
      status: enable ? 'running' : 'stopped',
    };
    simulatedModules.set(moduleId, next);
    return {
      id: moduleId,
      status: next.status,
      advisory: 'SIMULATED: no node is connected. Nothing on your network changed.',
    };
  },

  moduleMetrics(moduleId: string, points = 20): ModuleMetricsResponse {
    const now = Date.now();
    return {
      id: moduleId,
      tiles: [
        { label: 'Packets / Actions', value: String(Math.floor(Math.random() * 1000)) },
        { label: 'Threats / Flags', value: String(Math.floor(Math.random() * 50) + 10) },
        { label: 'Connections', value: String(Math.floor(Math.random() * 400) + 700) },
        { label: 'Uptime', value: '—' },
      ],
      series: Array.from({ length: points }, (_, i) => ({
        t: new Date(now - (points - i) * 2000).toISOString(),
        value1: Math.floor(Math.random() * 50) + 20,
        value2: Math.floor(Math.random() * 30) + 10,
      })),
    };
  },

  /** Extend a series by one point, preserving window length. */
  extendSeries(series: ModuleMetricsResponse['series']): ModuleMetricsResponse['series'] {
    return [
      ...series.slice(1),
      {
        t: new Date().toISOString(),
        value1: Math.floor(Math.random() * 50) + 20,
        value2: Math.floor(Math.random() * 30) + 10,
      },
    ];
  },
};
