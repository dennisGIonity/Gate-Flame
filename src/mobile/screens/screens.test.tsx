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

import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FilteringState } from '../../types/filtering';
import type { RouterCheckResponse } from '../../types/routerCheck';
import type { Polled, TelemetrySummary, ThreatsResponse } from '../../components/kiosk/kioskClient';
import { NodeError } from '../../components/kiosk/kioskClient';

// The gravity canvas is lazy and needs a 2D context jsdom cannot give it. The
// stand-in records the props Home hands it, so the wiring can be checked.
const canvas = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock('../../components/GravityParticleCanvas', () => ({
  GravityParticleCanvas: (props: Record<string, unknown>) => {
    canvas.props = props;
    return null;
  },
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
import { ControlsScreen } from './ControlsScreen';
import { NetworkScreen } from './NetworkScreen';
import { ActivityScreen } from './ActivityScreen';
import { routerPageUrl } from '../routerCheck';

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

/* ------------------------------------------------------------------ Settings */

/*
 * B2, 2026-10-03. The Settings chip was `paused ? 'paused' : enabled ? 'on' : 'off'`.
 * Today's agent forces enabled=false on every fault, so a FAILED box read as the
 * owner's own switch ("off"); any agent sending enabled=true with a fault got a green
 * "on" over a box blocking nothing. The chip now reads protectionStatus, all five.
 */
describe('ControlsScreen: the chip names all five protection states', () => {
  const CASES = [
    { status: 'active', label: 'protected', qualifier: null, colour: '#10B981' },
    { status: 'paused', label: 'paused', qualifier: null, colour: '#F59E0B' },
    { status: 'bypass', label: 'unprotected', qualifier: 'the box fell back', colour: '#E11D48' },
    { status: 'degraded', label: 'unprotected', qualifier: 'not blocking', colour: '#E11D48' },
    { status: 'unconfigured', label: 'unprotected', qualifier: 'setup incomplete', colour: '#E11D48' },
  ] as const;

  for (const c of CASES) {
    it(`${c.status} → "${c.label}"${c.qualifier ? ` · "${c.qualifier}"` : ''}, never "on"/"off" or the raw token`, () => {
      // enabled: true on EVERY case, deliberately - it is the payload that used to
      // turn a fault green. The chip must not consult it.
      render(<ControlsScreen filtering={polled<FilteringState>({ data: { ...filtering(c.status), enabled: true } })} />);
      const chip = screen.getByText(c.label);
      expect(chip.className).toContain(c.colour);
      if (c.qualifier) expect(screen.getByText(c.qualifier)).toBeTruthy();
      expect(screen.queryByText('on')).toBeNull();
      expect(screen.queryByText('off')).toBeNull();
      // `paused` maps to its own word; every other token must never appear raw.
      if (c.status !== 'paused') expect(screen.queryByText(c.status)).toBeNull();
    });
  }

  for (const s of ['bypass', 'degraded', 'unconfigured'] as const) {
    it(`${s} is never green, whatever "enabled" says`, () => {
      for (const enabled of [true, false]) {
        const view = render(<ControlsScreen filtering={polled<FilteringState>({ data: { ...filtering(s), enabled } })} />);
        expect(screen.getByText('unprotected').className).not.toContain('#10B981');
        view.unmount();
      }
    });
  }

  it('bypass never renders the pause reason - that field is what the owner typed when PAUSING', () => {
    render(
      <ControlsScreen
        filtering={polled<FilteringState>({ data: { ...filtering('bypass'), reason: 'homework hour' } })}
      />,
    );
    expect(screen.queryByText(/homework hour/)).toBeNull();
  });

  it('a status this build does not know renders the dash - not its raw token, not a guess', () => {
    const odd = { ...filtering('active'), protectionStatus: 'rebooting' } as unknown as FilteringState;
    render(<ControlsScreen filtering={polled<FilteringState>({ data: odd })} />);
    expect(screen.queryByText('rebooting')).toBeNull();
    expect(screen.queryByText('protected')).toBeNull();
    expect(screen.queryByText('unprotected')).toBeNull();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------- Network */

/*
 * B3, 2026-10-03. ADR-001's one customer step, read back from
 * GET /network/router-check. `forwardsToUs: null` is "could not tell" and is never
 * drawn as "not using your box". Built against the agreed contract while the route
 * was being written; the poll seam stands in for it here.
 */
describe('NetworkScreen: the router step, read back', () => {
  function check(over: Partial<RouterCheckResponse>): RouterCheckResponse {
    return {
      gateway: '192.168.124.1',
      boxAddress: '192.168.124.3',
      forwardsToUs: null,
      method: 'canary',
      checkedAt: 1_790_000_000,
      gap: null,
      ...over,
    };
  }
  function withRouter(p: Polled<RouterCheckResponse>) {
    polledFromTest.mockImplementation(
      (path) => (path === '/network/router-check' ? p : undefined) as unknown as Polled<unknown>,
    );
  }
  const VERDICT = /sending lookups|not using your box/;

  it('true: one line that says so, with the box address', () => {
    withRouter(polled({ data: check({ forwardsToUs: true }) }));
    render(<NetworkScreen active />);
    expect(screen.getByText('Your router is sending lookups to your box at 192.168.124.3')).toBeTruthy();
    expect(screen.queryByText(/not using your box/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open router page/ })).toBeNull();
  });

  it('false: the fix with the box address, the router address, and its page', () => {
    withRouter(polled({ data: check({ forwardsToUs: false }) }));
    render(<NetworkScreen active />);
    expect(
      screen.getByText('Your router is not using your box yet — set its DNS to 192.168.124.3'),
    ).toBeTruthy();
    expect(screen.getByText('192.168.124.1')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open router page/ }).getAttribute('href')).toBe('http://192.168.124.1/');
    expect(screen.queryByText(/sending lookups/)).toBeNull();
  });

  it('null: the node’s own reason, verbatim - never "not using your box"', () => {
    withRouter(polled({ data: check({ forwardsToUs: null, gap: 'router did not answer the canary query' }) }));
    render(<NetworkScreen active />);
    expect(screen.getByText('router did not answer the canary query')).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.queryByRole('link', { name: /Open router page/ })).toBeNull();
  });

  it('null with no reason given: the dash, still no verdict', () => {
    withRouter(polled({ data: check({ forwardsToUs: null, gap: null }) }));
    render(<NetworkScreen active />);
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('404: an older box says it cannot check yet, and gives no verdict', () => {
    withRouter(polled({ error: new NodeError('Not Found', 404, false) }));
    render(<NetworkScreen active />);
    expect(screen.getByText('This box cannot check your router yet')).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
  });

  it('still asking: a placeholder, never a verdict', () => {
    withRouter(polled({ loading: true }));
    render(<NetworkScreen active />);
    expect(screen.getByLabelText('Asking your box about your router')).toBeTruthy();
    expect(screen.queryByText(VERDICT)).toBeNull();
    expect(screen.queryByText(/cannot check your router/)).toBeNull();
  });

  it('"cannot reach it" and "it answered with an error" never share a sentence', () => {
    withRouter(polled({ error: UNREACHABLE }));
    const first = render(<NetworkScreen active />);
    expect(screen.getByText('Cannot reach your box.')).toBeTruthy();
    expect(screen.queryByText(/answered, but with an error/)).toBeNull();
    first.unmount();

    withRouter(polled({ error: REFUSED }));
    render(<NetworkScreen active />);
    expect(screen.getByText('Your box answered, but with an error: Pi-hole unreachable')).toBeTruthy();
    expect(screen.queryByText('Cannot reach your box.')).toBeNull();
  });

  it('a stale "yes" is not shown while the check is failing', () => {
    withRouter(polled({ data: check({ forwardsToUs: true }), error: UNREACHABLE }));
    render(<NetworkScreen active />);
    expect(screen.queryByText(/sending lookups/)).toBeNull();
    expect(screen.getByText('Cannot reach your box.')).toBeTruthy();
  });

  it('offers the router page only for a private IPv4 address', () => {
    expect(routerPageUrl('192.168.124.1')).toBe('http://192.168.124.1/');
    expect(routerPageUrl(' 10.0.0.1 ')).toBe('http://10.0.0.1/');
    expect(routerPageUrl('8.8.8.8')).toBeNull();
    expect(routerPageUrl('192.168.1.1/evil')).toBeNull();
    expect(routerPageUrl('192.168.1.1:8443')).toBeNull();
    expect(routerPageUrl('router.example')).toBeNull();
    expect(routerPageUrl('javascript:alert(1)')).toBeNull();
    expect(routerPageUrl(null)).toBeNull();
  });

  it('a public gateway address is shown but not offered as a link', () => {
    withRouter(polled({ data: check({ forwardsToUs: false, gateway: '8.8.8.8' }) }));
    render(<NetworkScreen active />);
    expect(screen.getByText('8.8.8.8')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open router page/ })).toBeNull();
  });
});

/* -------------------------------------------------------------- Home canvas */

describe('HomeScreen: only the owner’s own pause is called PAUSED on the gravity field', () => {
  const CASES = [
    { name: 'a fault', filtering: polled<FilteringState>({ data: filtering('degraded') }), stoppedBy: 'fault' },
    { name: 'the owner’s pause', filtering: polled<FilteringState>({ data: filtering('paused') }), stoppedBy: 'owner' },
    { name: 'an unreachable box', filtering: polled<FilteringState>({ error: UNREACHABLE }), stoppedBy: 'unknown' },
  ] as const;

  for (const c of CASES) {
    it(`${c.name} stops the field with stoppedBy="${c.stoppedBy}"`, async () => {
      canvas.props = null;
      render(<HomeScreen telemetry={polled<TelemetrySummary>({ data: TELEMETRY })} filtering={c.filtering} />);
      await waitFor(() => expect(canvas.props).not.toBeNull());
      expect(canvas.props?.isPaused).toBe(true);
      expect(canvas.props?.stoppedBy).toBe(c.stoppedBy);
    });
  }

  it('a live "active" reading leaves the field running', async () => {
    canvas.props = null;
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
        filtering={polled<FilteringState>({ data: filtering('active') })}
      />,
    );
    await waitFor(() => expect(canvas.props).not.toBeNull());
    expect(canvas.props?.isPaused).toBe(false);
  });
});

/* ------------------------------------------------------------ history copy */

describe('the lines 1.1.0 made false are gone (A7)', () => {
  it('Home no longer says the box keeps no history', () => {
    render(
      <HomeScreen
        telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
        filtering={polled<FilteringState>({ data: filtering('active') })}
      />,
    );
    expect(screen.queryByText(/keeps no history/)).toBeNull();
    expect(screen.queryByText(/Live only/)).toBeNull();
    // Its place is taken by the box's own record, still loading here.
    expect(screen.getByLabelText('Asking your box for its history')).toBeTruthy();
  });

  it('Activity no longer says no history is kept', () => {
    render(<ActivityScreen telemetry={polled<TelemetrySummary>({ data: TELEMETRY })} />);
    expect(screen.queryByText(/no history/i)).toBeNull();
    expect(screen.getByLabelText('Asking your box for its history')).toBeTruthy();
  });

  it('Health asks the box for its 24-hour record', () => {
    const asked: string[] = [];
    polledFromTest.mockImplementation((path) => {
      asked.push(path);
      return undefined as unknown as Polled<unknown>;
    });
    render(
      <HealthScreen
        telemetry={polled<TelemetrySummary>({ data: TELEMETRY })}
        filtering={polled<FilteringState>({ data: filtering('active') })}
        active
      />,
    );
    expect(asked).toContain('/history/system?window=24h');
  });
});
