/* ========================================================================================
 * GATE^FLAME MOBILE - THE BOX'S OWN HISTORY, DRAWN (A7)
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * /dns/history and /history/system shipped in 1.1.0 and nothing drew them, while the app
 * still said "Live only — the box keeps no history yet." These tests pin how they are
 * drawn, through the REAL transport: `fetch` is the only thing mocked, so usePolled,
 * nodeRequest and NodeError (404 vs unreachable vs refused) are all under test.
 *
 *   points        render as a chart, captioned with the node's own resolution
 *   sparse        a missing bucket is a break in the line, never a straight join
 *   gap           `points: []` + `gap` renders the gap verbatim - not an empty chart
 *   404           an older box: "This box cannot show history yet"
 *   loading       a placeholder, never a chart or a sentence
 *   window        the old window's points are never drawn under the new label
 *   clock         the grid is laid on the BOX's clock; the phone's is never consulted
 * ======================================================================================== */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DnsHistoryPoint, DnsHistoryResponse, SystemHistoryResponse } from '../types/history';
import { LookupsHistory, NOT_ON_THIS_BOX, VitalsHistory, historyCaption, toBuckets } from './history';

type Reply = { status: number; body?: unknown } | 'unreachable' | 'never';

/** Serve canned replies by path suffix; returns every URL that was asked for. */
function serve(routes: Record<string, Reply>): string[] {
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      const key = Object.keys(routes).find((k) => url.endsWith(k));
      const reply: Reply = key ? routes[key] : { status: 404, body: { detail: 'Not Found' } };
      if (reply === 'unreachable') throw new TypeError('Failed to fetch');
      if (reply === 'never') return new Promise<Response>(() => {});
      return new Response(JSON.stringify(reply.body ?? null), {
        status: reply.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// A real-looking box timestamp, aligned to every step the contract uses.
const T = 1_790_006_400;

function pt(t: number, total: number | null, blocked: number | null): DnsHistoryPoint {
  return { t, total, blocked, cached: null, forwarded: null };
}

function dns(over: Partial<DnsHistoryResponse> & Pick<DnsHistoryResponse, 'window'>): DnsHistoryResponse {
  const spec = {
    '24h': { stepSeconds: 600, resolution: '10 minute totals' },
    '7d': { stepSeconds: 3600, resolution: '1 hour totals' },
    '30d': { stepSeconds: 21600, resolution: '6 hour totals' },
  }[over.window];
  return { ...spec, source: 'pihole', points: [], gap: null, fetchedAt: T + 30, ...over };
}

const DNS_24H = '/dns/history?window=24h';

/* ------------------------------------------------------------------ lookups */

describe('LookupsHistory', () => {
  it('draws the points, captioned with the node’s own resolution and the window asked for', async () => {
    serve({
      [DNS_24H]: {
        status: 200,
        body: dns({ window: '24h', points: [pt(T - 1200, 40, 4), pt(T - 600, 50, 5), pt(T, 60, 6)] }),
      },
    });
    render(<LookupsHistory initialRange="24h" />);
    const chart = await screen.findByRole('img', {
      name: 'Looked up and blocked, 10 minute totals, last 24 hours',
    });
    expect(screen.getByText('10 minute totals, last 24 hours')).toBeTruthy();
    // Both series are drawn, each as one unbroken line.
    expect(chart.querySelectorAll('g[data-series="Looked up"] path[fill="none"]')).toHaveLength(1);
    expect(chart.querySelectorAll('g[data-series="Blocked"] path[fill="none"]')).toHaveLength(1);
    // And the legend names them, now that there is a chart to explain.
    expect(screen.getByText('Looked up')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('a missing bucket breaks the line instead of being joined across', async () => {
    // T - 600 is absent: the box was off, or stored nothing. Not zero.
    serve({
      [DNS_24H]: {
        status: 200,
        body: dns({ window: '24h', points: [pt(T - 1800, 40, 4), pt(T - 1200, 50, 5), pt(T, 60, 6)] }),
      },
    });
    render(<LookupsHistory initialRange="24h" />);
    const chart = await screen.findByRole('img', { name: /10 minute totals, last 24 hours/ });
    // Two runs: a line across the first two buckets, and the last bucket on its own.
    expect(chart.querySelectorAll('g[data-series="Looked up"] path[fill="none"]')).toHaveLength(2);
  });

  it('empty points with a gap renders the gap verbatim, and no chart pretending to be zero', async () => {
    const gap = 'Pi-hole did not answer for the 24h DNS history';
    serve({ [DNS_24H]: { status: 200, body: dns({ window: '24h', points: [], gap }) } });
    render(<LookupsHistory initialRange="24h" />);
    expect(await screen.findByText(gap)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    // No legend for a chart that is not there.
    expect(screen.queryByText('Looked up')).toBeNull();
  });

  it('a 404 is an older box: the not-on-this-box line, no chart, no gap', async () => {
    serve({ [DNS_24H]: { status: 404, body: { detail: 'Not Found' } } });
    render(<LookupsHistory initialRange="24h" />);
    expect(await screen.findByText(NOT_ON_THIS_BOX)).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/Cannot reach your box/)).toBeNull();
  });

  it('while the box has not answered: a placeholder, never a chart or a sentence', () => {
    serve({ [DNS_24H]: 'never' });
    render(<LookupsHistory initialRange="24h" />);
    expect(screen.getByLabelText('Asking your box for its history')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(NOT_ON_THIS_BOX)).toBeNull();
    expect(screen.queryByText(/last 24 hours/)).toBeNull();
  });

  it('"cannot reach it" and "it answered with an error" never share a sentence', async () => {
    serve({ [DNS_24H]: 'unreachable' });
    const first = render(<LookupsHistory initialRange="24h" />);
    expect(await screen.findByText('Cannot reach your box.')).toBeTruthy();
    expect(screen.queryByText(/answered, but with an error/)).toBeNull();
    first.unmount();

    serve({ [DNS_24H]: { status: 500, body: { detail: 'history store is locked' } } });
    render(<LookupsHistory initialRange="24h" />);
    expect(await screen.findByText('Your box answered, but with an error: history store is locked')).toBeTruthy();
    expect(screen.queryByText('Cannot reach your box.')).toBeNull();
  });

  it('switching the window never draws the old window’s points under the new label', async () => {
    const asked = serve({
      '/dns/history?window=7d': {
        status: 200,
        body: dns({ window: '7d', points: [pt(T - 7200, 400, 40), pt(T - 3600, 500, 50), pt(T, 600, 60)] }),
      },
      '/dns/history?window=30d': 'never',
    });
    render(<LookupsHistory initialRange="7d" switchable />);
    expect(await screen.findByRole('img', { name: /1 hour totals, last 7 days/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '30d' }));

    // usePolled still holds the 7-day payload here. It must not be drawn as 30 days.
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByText(/last 7 days/)).toBeNull();
    expect(screen.getByLabelText('Asking your box for its history')).toBeTruthy();
    expect(screen.getByRole('button', { name: '30d' }).getAttribute('aria-pressed')).toBe('true');
    expect(asked.some((u) => u.endsWith('/dns/history?window=30d'))).toBe(true);
  });
});

/* ------------------------------------------------------------------- vitals */

describe('VitalsHistory', () => {
  const SYS = '/history/system?window=24h';

  function sys(over: Partial<SystemHistoryResponse>): SystemHistoryResponse {
    return {
      window: '24h',
      stepSeconds: 300,
      resolution: '5 minute averages',
      points: [],
      since: T - 86_400,
      gap: null,
      sampling: true,
      sampleIntervalSeconds: 60,
      ...over,
    };
  }

  it('draws processor and temperature; a sensor that read nothing is a dash, not a flat zero', async () => {
    serve({
      [SYS]: {
        status: 200,
        body: sys({
          points: [
            { t: T - 300, cpu: 12, memPct: 40, tempC: null, diskPct: 30 },
            { t: T, cpu: 15, memPct: 41, tempC: null, diskPct: 30 },
          ],
        }),
      },
    });
    render(<VitalsHistory />);
    expect(await screen.findByRole('img', { name: 'Processor, 5 minute averages, last 24 hours' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /^Temperature/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'No readings in this window' })).toBeTruthy();
    expect(screen.getByText('5 minute averages, last 24 hours')).toBeTruthy();
  });

  it('points AND a gap (the sampler stopped): the record and the node’s sentence, both', async () => {
    const gap =
      'the history sampler is not running on this box, so no new points are being recorded; what is shown stops at the last stored sample';
    serve({
      [SYS]: {
        status: 200,
        body: sys({
          sampling: false,
          gap,
          points: [
            { t: T - 300, cpu: 20, memPct: 40, tempC: 51, diskPct: 30 },
            { t: T, cpu: 22, memPct: 41, tempC: 52, diskPct: 30 },
          ],
        }),
      },
    });
    render(<VitalsHistory />);
    expect(await screen.findByRole('img', { name: /^Temperature, / })).toBeTruthy();
    expect(screen.getByText(gap)).toBeTruthy();
  });

  it('a 404 is an older box', async () => {
    serve({ [SYS]: { status: 404, body: { detail: 'Not Found' } } });
    render(<VitalsHistory />);
    expect(await screen.findByText(NOT_ON_THIS_BOX)).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ buckets */

describe('toBuckets', () => {
  const p = (t: number) => ({ t });

  it('lays sparse points on a regular grid, null where a bucket is missing, ending at the box’s now', () => {
    // step 600, a one-hour window ending at the box's own clock (endHint):
    // 7 buckets, T-3600 … T. Nothing was stored for four of them.
    const out = toBuckets([p(T - 1800), p(T - 1200), p(T)], 600, 3600, T + 59);
    expect(out.map((b) => (b ? b.t - T : null))).toEqual([null, null, null, -1800, -1200, null, 0]);
  });

  it('a box that has recorded nothing lately shows that as a trailing gap, not a squeezed line', () => {
    // The box's clock says T+1200; its newest bucket is T. The window ends at
    // the box's now, so the last two buckets are honestly empty.
    const out = toBuckets([p(T - 600), p(T)], 600, 1200, T + 1205);
    expect(out.map((b) => (b ? b.t - T : null))).toEqual([0, null, null]);
  });

  it('without a clock hint the grid ends at the newest bucket', () => {
    const out = toBuckets([p(T - 1200), p(T)], 600, 1200);
    expect(out.map((b) => (b ? b.t - T : null))).toEqual([-1200, null, 0]);
  });

  it('a box clock hint older than the newest point never cuts that point off', () => {
    const out = toBuckets([p(T - 600), p(T)], 600, 1200, T - 6000);
    expect(out[out.length - 1]?.t).toBe(T);
  });

  it('never consults the phone’s clock: a phone years ahead of the box changes nothing', () => {
    const before = toBuckets([p(T - 600), p(T)], 600, 1200, T);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2031-06-01T00:00:00Z'));
    const after = toBuckets([p(T - 600), p(T)], 600, 1200, T);
    expect(after).toEqual(before);
    expect(after.filter(Boolean)).toHaveLength(2);
  });

  it('nothing in, nothing out', () => {
    expect(toBuckets([], 600, 86_400, T)).toEqual([]);
  });
});

describe('historyCaption', () => {
  it('is the node’s resolution, then the window asked for', () => {
    expect(historyCaption('10 minute totals', '24h')).toBe('10 minute totals, last 24 hours');
    expect(historyCaption('1 hour totals', '7d')).toBe('1 hour totals, last 7 days');
    expect(historyCaption('6 hour totals', '30d')).toBe('6 hour totals, last 30 days');
  });

  it('without a resolution it names only the window, and invents none', () => {
    expect(historyCaption(null, '24h')).toBe('Last 24 hours');
  });
});
