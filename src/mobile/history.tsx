/**
 * History — the box's own record, drawn.
 *
 * Until 1.1.0 the box kept nothing, so every chart in this app was a ring
 * buffer that started empty when the screen opened, and the copy said so
 * ("Live only — the box keeps no history yet."). The node now serves two
 * routes that nobody drew:
 *
 *   /dns/history?window=24h|7d|30d     lookups and blocks, from Pi-hole's own history
 *   /history/system?window=24h|7d|30d  CPU / memory / temperature / disk, from the on-box sampler
 *
 * Contracts in types/history.ts. The rules this module enforces for every
 * screen that draws them:
 *
 *   EMPTY WITH A GAP IS THE GAP. `points: []` plus `gap` renders the node's
 *   sentence verbatim, never an empty chart that would read as zero.
 *
 *   A MISSING BUCKET IS A BREAK IN THE LINE. The routes are sparse - a bucket
 *   with nothing stored is absent - so points are laid on a regular grid and
 *   a hole stays a hole. Drawing straight through it would claim the box was
 *   counting while it was off.
 *
 *   THE BOX'S CLOCK, NEVER THE PHONE'S. The grid ends at the box's own "now"
 *   (`fetchedAt`) or its newest bucket. Placed against `Date.now()`, a Pi whose
 *   clock is days behind (no NTP) would have no points "in the last 24 hours".
 *
 *   NO STALE WINDOW UNDER A NEW LABEL. `usePolled` keeps the previous payload
 *   across a path change, so right after the 24h/7d/30d switch it still holds
 *   the old window's points. They are not drawn until the payload's own
 *   `window` matches the one asked for.
 *
 *   404 IS AN OLDER BOX, not a broken one: "This box cannot show history yet".
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

import { usePolled, type Polled } from '../components/kiosk/kioskClient';
import { CH } from '../components/kiosk/charts';
import type { DnsHistoryResponse, HistoryWindow, SystemHistoryResponse } from '../types/history';
import { Card, ChartCard, DASH, Gap, Skeleton } from './mobileUi';

export const HISTORY_WINDOWS: readonly HistoryWindow[] = ['24h', '7d', '30d'];

export const WINDOW_SECONDS: Record<HistoryWindow, number> = {
  '24h': 86_400,
  '7d': 7 * 86_400,
  '30d': 30 * 86_400,
};

const WINDOW_PHRASE: Record<HistoryWindow, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

/** The node caches 24h for 60 s and the long windows for 10 minutes; asking faster buys nothing. */
const POLL_MS: Record<HistoryWindow, number> = { '24h': 60_000, '7d': 300_000, '30d': 300_000 };

export const NOT_ON_THIS_BOX = 'This box cannot show history yet';

/** "10 minute totals, last 24 hours" - the node's resolution, then the window asked for. */
export function historyCaption(resolution: string | null | undefined, range: HistoryWindow): string {
  const phrase = WINDOW_PHRASE[range];
  return resolution ? `${resolution}, ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/* ---------------------------------------------------------------- buckets */

/** Past this many buckets the step is not one the contract uses; draw the points as given. */
const MAX_BUCKETS = 1000;

/**
 * Lay sparse points on a regular grid, `null` where a bucket is missing.
 *
 * The grid ends at `endHint` (the box's own clock) when it is given and not
 * older than the newest point, otherwise at the newest point, and spans
 * `windowSeconds` back from there - so the chart's width IS the window, and a
 * box with two hours of history draws two hours at the right-hand edge rather
 * than stretching them across a day.
 */
export function toBuckets<P extends { t: number }>(
  points: readonly P[],
  stepSeconds: number,
  windowSeconds: number,
  endHint?: number | null,
): (P | null)[] {
  const real = points.filter((p) => p && Number.isFinite(p.t)).sort((a, b) => a.t - b.t);
  if (real.length === 0) return [];
  if (!(stepSeconds > 0) || !(windowSeconds > 0)) return real;

  const floor = (t: number) => t - (((t % stepSeconds) + stepSeconds) % stepSeconds);
  const newest = floor(real[real.length - 1].t);
  const end =
    typeof endHint === 'number' && Number.isFinite(endHint) ? Math.max(newest, floor(endHint)) : newest;
  const start = floor(end - windowSeconds);
  const count = Math.round((end - start) / stepSeconds) + 1;
  if (count > MAX_BUCKETS) return real;

  const at = new Map<number, P>();
  for (const p of real) {
    const b = floor(p.t);
    if (b >= start && b <= end) at.set(b, p);
  }
  return Array.from({ length: count }, (_, i) => at.get(start + i * stepSeconds) ?? null);
}

/* ------------------------------------------------------------------ chart */

export interface HistorySeries {
  label: string;
  colour: string;
  values: (number | null)[];
  fill?: boolean;
}

/**
 * Several series on one zero-anchored scale, in plain SVG.
 *
 * Zero-anchored because these are per-bucket amounts, not running totals, so
 * zero is a real and informative floor. A run of one bucket between two holes
 * is drawn as a dot rather than dropped - on a sparse 30-day series those
 * islands are often most of the data. No moving head, no draw-in: this is a
 * record, and nothing on it is live.
 */
export function HistoryChart({
  series,
  height = 96,
  max,
  label,
}: {
  series: HistorySeries[];
  height?: number;
  max?: number;
  label: string;
}) {
  const W = 320;
  const PAD = 4;
  const n = series.reduce((m, s) => Math.max(m, s.values.length), 0);
  const known = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  if (n < 2 || known.length === 0) return <NoReadings height={height} />;

  const top = max ?? Math.max(...known);
  const scale = top > 0 ? top : 1;
  const x = (i: number) => (i * W) / (n - 1);
  const y = (v: number) => height - PAD - (Math.min(Math.max(v, 0), scale) / scale) * (height - PAD * 2);

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="w-full overflow-visible"
      style={{ height }}
      role="img"
      aria-label={label}
    >
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={W}
          y1={height * f}
          y2={height * f}
          stroke={CH.grid}
          strokeWidth="1"
          strokeDasharray="2 6"
          opacity="0.5"
        />
      ))}
      {series.map((s) => {
        const runs = runsOf(s.values);
        return (
          <g key={s.label} data-series={s.label}>
            {s.fill &&
              runs
                .filter((r) => r.length > 1)
                .map((r) => (
                  <path
                    key={`f${r[0]}`}
                    d={`${linePath(r, s.values, x, y)} L${x(r[r.length - 1]).toFixed(1)},${height} L${x(r[0]).toFixed(1)},${height} Z`}
                    fill={s.colour}
                    fillOpacity="0.14"
                    stroke="none"
                  />
                ))}
            {runs.map((r) => (
              <path
                key={`s${r[0]}`}
                d={
                  r.length > 1
                    ? linePath(r, s.values, x, y)
                    : `M${x(r[0]).toFixed(1)},${y(s.values[r[0]] as number).toFixed(1)} l0.01,0`
                }
                fill="none"
                stroke={s.colour}
                strokeWidth={r.length > 1 ? 1.75 : 3.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Index runs of consecutive known values. */
function runsOf(values: (number | null)[]): number[][] {
  const runs: number[][] = [];
  let run: number[] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(i);
    }
  });
  if (run.length) runs.push(run);
  return runs;
}

function linePath(
  run: number[],
  values: (number | null)[],
  x: (i: number) => number,
  y: (v: number) => number,
): string {
  return run
    .map((i, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(values[i] as number).toFixed(1)}`)
    .join(' ');
}

/** The box answered and holds nothing for this window: an empty frame and a dash, not a flat zero. */
function NoReadings({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center rounded-xl border border-dashed border-[#1E293B] font-mono text-sm text-[#475569]"
      style={{ height }}
      role="img"
      aria-label="No readings in this window"
    >
      {DASH}
    </div>
  );
}

/* ------------------------------------------------------------------ state */

type HistoryPayload = { window?: HistoryWindow; points: unknown[]; gap: string | null };

/**
 * Every way a history request can come back, each said differently:
 * an older box, no answer, a refusal, still asking, the node's own gap, or data.
 */
function HistoryState<R extends HistoryPayload>({
  polled,
  range,
  height,
  children,
}: {
  polled: Polled<R>;
  range: HistoryWindow;
  height: number;
  children: (data: R) => ReactNode;
}) {
  const err = polled.error;
  if (err) {
    return (
      <p className="text-sm leading-relaxed text-slate-300">
        {err.status === 404
          ? NOT_ON_THIS_BOX
          : err.unreachable
            ? 'Cannot reach your box.'
            : `Your box answered, but with an error: ${err.message}`}
      </p>
    );
  }

  const d = currentFor(polled, range);
  if (!d) {
    return (
      <div aria-label="Asking your box for its history" style={{ height }}>
        <Skeleton className="h-full w-full" />
      </div>
    );
  }

  const points = Array.isArray(d.points) ? d.points : [];
  if (points.length === 0) {
    // The node's sentence IS the content here. No frame around it: an empty
    // chart beside an explanation still reads as a chart of nothing.
    return d.gap ? (
      <p className="text-sm leading-relaxed text-slate-300">{d.gap}</p>
    ) : (
      <NoReadings height={height} />
    );
  }

  return (
    <>
      {children(d)}
      {/* Points AND a gap: e.g. the sampler has stopped, so the record ends
          early. Both are true; both are shown. */}
      <Gap text={d.gap} />
    </>
  );
}

/** The payload, only if it answers the window asked for. */
function currentFor<R extends HistoryPayload>(polled: Polled<R>, range: HistoryWindow): R | null {
  const d = polled.data;
  if (!d) return null;
  return d.window === undefined || d.window === range ? d : null;
}

function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <span className="flex flex-wrap items-center gap-3">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: it.colour }} aria-hidden />
          {it.label}
        </span>
      ))}
    </span>
  );
}

/* --------------------------------------------------------------- lookups */

const LOOKED_UP = { label: 'Looked up', colour: CH.cyan };
const BLOCKED = { label: 'Blocked', colour: CH.orange };

/**
 * Lookups against blocks, from Pi-hole's own history.
 *
 * Home shows the last 24 hours, fixed. Activity offers the switch and opens on
 * a week. Each caption is the node's own `resolution` plus the window asked for.
 */
export function LookupsHistory({
  initialRange = '24h',
  switchable = false,
  height = 96,
}: {
  initialRange?: HistoryWindow;
  switchable?: boolean;
  height?: number;
}) {
  const [range, setRange] = useState<HistoryWindow>(initialRange);
  const polled = usePolled<DnsHistoryResponse>(`/dns/history?window=${range}`, POLL_MS[range]);
  const d = polled.error ? null : currentFor(polled, range);
  const drawn = Boolean(d && Array.isArray(d.points) && d.points.length > 0);

  return (
    <ChartCard
      label="Lookups"
      footer={
        d ? (
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {/* A legend only when there is a chart for it to explain. */}
            {drawn && <Legend items={[LOOKED_UP, BLOCKED]} />}
            <span>{historyCaption(d.resolution, range)}</span>
          </span>
        ) : undefined
      }
    >
      {switchable && <RangeSwitch value={range} onChange={setRange} />}
      <HistoryState polled={polled} range={range} height={height}>
        {(data) => {
          const buckets = toBuckets(data.points, data.stepSeconds, WINDOW_SECONDS[range], data.fetchedAt);
          return (
            <HistoryChart
              height={height}
              label={`Looked up and blocked, ${historyCaption(data.resolution, range)}`}
              series={[
                { ...LOOKED_UP, values: buckets.map((b) => b?.total ?? null), fill: true },
                { ...BLOCKED, values: buckets.map((b) => b?.blocked ?? null), fill: true },
              ]}
            />
          );
        }}
      </HistoryState>
    </ChartCard>
  );
}

function RangeSwitch({ value, onChange }: { value: HistoryWindow; onChange: (w: HistoryWindow) => void }) {
  return (
    <div
      role="group"
      aria-label="History window"
      className="mb-3 grid grid-cols-3 gap-1 rounded-xl border border-[#1E293B] bg-[#0F1B2D] p-1"
    >
      {HISTORY_WINDOWS.map((w) => {
        const on = w === value;
        return (
          <button
            key={w}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(w)}
            className={`min-h-[44px] rounded-lg font-mono text-xs font-semibold tabular-nums transition-colors ${
              on ? 'bg-[#38BDF8]/15 text-[#38BDF8]' : 'text-[#64748B]'
            }`}
          >
            {w}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- vitals */

/**
 * The box's processor and temperature over the last 24 hours, from its own
 * 60-second sampler. Scales match the live traces above them on Health: CPU
 * against 100 %, temperature against 85 °C, the Pi's hard-throttle point.
 */
export function VitalsHistory({ active = true, height = 56 }: { active?: boolean; height?: number }) {
  const range: HistoryWindow = '24h';
  const polled = usePolled<SystemHistoryResponse>(`/history/system?window=${range}`, POLL_MS[range], active);
  const d = polled.error ? null : currentFor(polled, range);

  return (
    <Card>
      <HistoryState polled={polled} range={range} height={height}>
        {(data) => {
          const buckets = toBuckets(data.points, data.stepSeconds, WINDOW_SECONDS[range]);
          const caption = historyCaption(data.resolution, range);
          return (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#64748B]">Processor</p>
                <HistoryChart
                  height={height}
                  max={100}
                  label={`Processor, ${caption}`}
                  series={[{ label: 'Processor', colour: CH.cyan, values: buckets.map((b) => b?.cpu ?? null), fill: true }]}
                />
              </div>
              <div>
                <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-[#64748B]">Temperature</p>
                <HistoryChart
                  height={height}
                  max={85}
                  label={`Temperature, ${caption}`}
                  series={[
                    { label: 'Temperature', colour: CH.orange, values: buckets.map((b) => b?.tempC ?? null), fill: true },
                  ]}
                />
              </div>
            </div>
          );
        }}
      </HistoryState>
      {d && <p className="mt-3 text-[11px] leading-relaxed text-[#64748B]">{historyCaption(d.resolution, range)}</p>}
    </Card>
  );
}
