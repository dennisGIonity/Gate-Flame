/* ========================================================================================
 * GATE^FLAME MOBILE - A MISSING READING IS NEVER A VERDICT
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * Found in the 2026-10-02 mobile pass. Each of these rendered a confident statement
 * from a reading the box had not given:
 *
 *   Home     said "Cannot see your box - are you on home Wi-Fi?" before the first poll
 *            had answered, and again when the box was reachable but REFUSED /filtering.
 *            It also drew a green verdict from a stale payload while /filtering was
 *            failing.
 *   Health   printed "Silent" in fault red for the filter service when telemetry was
 *            simply null, and a "silent" chip while still loading.
 *   Blocked  turned a missing blocked-in-window count into a "0%" ring.
 *
 * The rule is the one on every other figure in this app: null is not zero, and
 * "cannot reach it" and "reached it, it refused" never share a sentence.
 * ======================================================================================== */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FilteringState } from '../../types/filtering';
import type { Polled, TelemetrySummary, ThreatsResponse } from '../../components/kiosk/kioskClient';
import { NodeError } from '../../components/kiosk/kioskClient';

// The gravity canvas is lazy and needs a 2D context jsdom cannot give it.
vi.mock('../../components/GravityParticleCanvas', () => ({
  GravityParticleCanvas: () => null,
}));

// Screens that own a poll (Health → /services, Blocked → /threats) get it fed
// through this seam so no test here touches the network.
const polledFromTest = vi.fn<(path: string) => Polled<unknown>>();
vi.mock('../../components/kiosk/kioskClient', async (orig) => {
  const real = await orig<typeof import('../../components/kiosk/kioskClient')>();
  return {
    ...real,
    usePolled: (path: string) => polledFromTest(path) ?? idle(),
  };
});

import { HomeScreen } from './HomeScreen';
import { HealthScreen } from './HealthScreen';
import { ThreatsScreen } from './ThreatsScreen';

function idle<T>(): Polled<T> {
  return { data: null, error: null, lastSeen: null, loading: false, refresh: () => {} };
}

function polled<T>(over: Partial<Polled<T>>): Polled<T> {
  return { ...idle<T>(), ...over };
}

const UNREACHABLE = new NodeError('no route to the node agent', null, true);
const REFUSED = new NodeError('Pi-hole unreachable', 503, false);

const TELEMETRY: TelemetrySummary = {
  totalQueriesToday: 2855,
  queriesBlockedToday: 14,
  blockPercentage: 0.5,
  domainsOnGravity: 340446,
  activeClientsCount: 4,
  dataSavedMB: 1,
  avgLatencyMs: 3,
  uptimeSeconds: 86400,
  host: null,
  piholeReachable: true,
};

function filtering(status: FilteringState['protectionStatus']): FilteringState {
  return {
    protectionStatus: status,
    enabled: status === 'active',
    pausedUntil: null,
    secondsRemaining: null,
    durationLabel: null,
    reason: null,
    threatLevel: { level: 'low', description: 'node text', blocklistCount: 3 },
    availableLevels: [],
    categories: [],
    pauseDurations: [],
    applying: false,
    lastError: null,
  };
}

/* ---------------------------------------------------------------------- Home */

describe('HomeScreen: no verdict before the box has answered', () => {
  it('shows a placeholder, not "Cannot see your box", while both polls are still in flight', () => {
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ loading: true })}
        filtering={polled<FilteringState>({ loading: true })}
      />,
    );
    expect(screen.queryByText('Cannot see your box')).toBeNull();
    expect(screen.queryByText(/home Wi-Fi/)).toBeNull();
    expect(screen.queryByText('Your network is filtered')).toBeNull();
    expect(screen.getByLabelText('Asking your box')).toBeTruthy();
  });

  it('still says "Cannot see your box" and gives the Wi-Fi hint when nothing answers', () => {
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ error: UNREACHABLE })}
        filtering={polled<FilteringState>({ error: UNREACHABLE })}
      />,
    );
    expect(screen.getByText('Cannot see your box')).toBeTruthy();
    expect(screen.getByText(/home Wi-Fi/)).toBeTruthy();
  });

  it('a refusal shows the node’s own sentence and NOT the Wi-Fi hint', () => {
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
        filtering={polled<FilteringState>({ error: REFUSED })}
      />,
    );
    expect(screen.getByText('Your box answered, but with an error')).toBeTruthy();
    expect(screen.getByText('Pi-hole unreachable')).toBeTruthy();
    expect(screen.queryByText(/home Wi-Fi/)).toBeNull();
    expect(screen.queryByText('Your network is filtered')).toBeNull();
  });

  it('a stale "active" payload is not shown as the live verdict while /filtering is failing', () => {
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
        filtering={polled<FilteringState>({ data: filtering('active'), error: REFUSED })}
      />,
    );
    expect(screen.queryByText('Your network is filtered')).toBeNull();
    expect(screen.getByText('Your box answered, but with an error')).toBeTruthy();
  });

  it('a live "active" reading still renders the approved line', () => {
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
        filtering={polled<FilteringState>({ data: filtering('active') })}
      />,
    );
    expect(screen.getByText('Your network is filtered')).toBeTruthy();
    expect(screen.queryByText(/home Wi-Fi/)).toBeNull();
  });

  for (const s of ['bypass', 'degraded', 'unconfigured'] as const) {
    it(`${s} renders as not filtering, never as filtered`, () => {
      render(
        <HomeScreen
          telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
          filtering={polled<FilteringState>({ data: filtering(s) })}
        />,
      );
      expect(screen.getByText('Not filtering')).toBeTruthy();
      expect(screen.queryByText('Your network is filtered')).toBeNull();
    });
  }
});

/* -------------------------------------------------------------------- Health */

describe('HealthScreen: the filter service is not "Silent" until the box has said so', () => {
  it('renders a dash for the filter service while telemetry is null', () => {
    render(
      <HealthScreen
        telemetry={polled<TelemetrySummary>({ loading: true })}
        filtering={polled<FilteringState>({ loading: true })}
        active
      />,
    );
    expect(screen.queryByText('Silent')).toBeNull();
    expect(screen.queryByText('silent')).toBeNull();
    expect(screen.queryByText('Answering')).toBeNull();
  });

  it('says Silent only when the box reported piholeReachable=false', () => {
    render(
      <HealthScreen
        telemetry={polled<TelemetrySummary>({ data: { ...TELEMETRY, piholeReachable: false } })}
        filtering={polled<FilteringState>({ data: filtering('degraded') })}
        active
      />,
    );
    expect(screen.getByText('Silent')).toBeTruthy();
    expect(screen.getByText('silent')).toBeTruthy();
  });

  it('a refusal on /telemetry/summary is reported as a refusal, not as offline', () => {
    render(
      <HealthScreen
        telemetry={polled<TelemetrySummary>({ error: REFUSED })}
        filtering={polled<FilteringState>({ data: filtering('active') })}
        active
      />,
    );
    expect(screen.getByText('Your box answered, but with an error')).toBeTruthy();
    expect(screen.getByText('Pi-hole unreachable')).toBeTruthy();
    expect(screen.queryByText('offline')).toBeNull();
    expect(screen.queryByText(/cannot reach the box/)).toBeNull();
  });

  it('unreachable is still "offline" with the cannot-reach warning', () => {
    render(
      <HealthScreen
        telemetry={polled<TelemetrySummary>({ error: UNREACHABLE })}
        filtering={polled<FilteringState>({ error: UNREACHABLE })}
        active
      />,
    );
    expect(screen.getByText('offline')).toBeTruthy();
    expect(screen.getByText(/cannot reach the box/)).toBeTruthy();
    expect(screen.queryByText('Your box answered, but with an error')).toBeNull();
  });
});

/* ------------------------------------------------------------------- Blocked */

describe('ThreatsScreen: the refusal ring needs both figures', () => {
  function threats(over: Partial<ThreatsResponse>): ThreatsResponse {
    return { entries: [], source: 'pihole', ...over };
  }

  it('draws the dash, not 0%, when blockedInWindow is missing', () => {
    polledFromTest.mockImplementation(() =>
      polled<ThreatsResponse>({ data: threats({ scanned: 500, blockedInWindow: undefined }) }),
    );
    const { container } = render(<ThreatsScreen active />);
    const ring = container.querySelector('svg[aria-label="gauge"] text');
    expect(ring?.textContent).toBe('—');
  });

  it('draws the real share when both figures are present', () => {
    polledFromTest.mockImplementation(() =>
      polled<ThreatsResponse>({ data: threats({ scanned: 500, blockedInWindow: 25 }) }),
    );
    const { container } = render(<ThreatsScreen active />);
    const ring = container.querySelector('svg[aria-label="gauge"] text');
    expect(ring?.textContent).toBe('5%');
  });

  it('a real zero is drawn as 0%, not as the dash', () => {
    polledFromTest.mockImplementation(() =>
      polled<ThreatsResponse>({ data: threats({ scanned: 500, blockedInWindow: 0 }) }),
    );
    const { container } = render(<ThreatsScreen active />);
    const ring = container.querySelector('svg[aria-label="gauge"] text');
    expect(ring?.textContent).toBe('0%');
  });
});
