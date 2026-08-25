/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame: the shared visualisation vocabulary
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Charts and motion, shared by the appliance console and the phone.
 *
 * `kioskUi.tsx` holds the plain primitives — a line, a donut, a bar. This file
 * holds the ones that MOVE, and it exists as a separate module for one reason:
 *
 *   MOTION MUST NEVER IMPLY DATA.
 *
 * An animation that eases a number from 0 to 82,562 has, for about 600ms,
 * displayed numbers the node never returned. That is tolerable ONLY because the
 * eye reads it as a transition rather than as a reading, and only if every
 * component here obeys the same three rules:
 *
 *   1. `null` never animates. It renders the dash immediately and stays there.
 *      There is no in-between state on the way to "we do not know".
 *   2. Nothing loops on a timer that could be mistaken for a live feed. The
 *      backdrop drifts; it does not pretend to be traffic.
 *   3. `prefers-reduced-motion` is honoured everywhere, and the still frame is
 *      always the TRUE frame — the final value, the full path, the real ring.
 *      Turning motion off must never turn information off with it.
 *
 * Hand-rolled SVG and one small canvas, no charting library. The console
 * redraws on a Pi 5 driving 1920x1080 over HDMI and the phone runs this inside
 * a WebView on whatever handset the customer owns; a few hundred bytes of path
 * arithmetic costs nothing and drops no frames, where Recharts costs 373 kB.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DASH, type Sample } from './kioskClient';

export const CH = {
  cyan: '#38BDF8',
  blue: '#006FD3',
  orange: '#FF8700',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#E11D48',
  grid: '#1E293B',
  muted: '#475569',
} as const;

/** One shared media query rather than one per component. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** True while the tab is hidden. Every rAF loop below parks itself on this. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  return visible;
}

/* ------------------------------------------------------------------ number */

/**
 * A figure that eases to its new value instead of snapping.
 *
 * `null` short-circuits before the animation exists — see rule 1. There is no
 * path through this component where a missing reading becomes a moving zero.
 */
export function AnimatedNumber({
  value,
  format,
  ms = 650,
  className = '',
}: {
  value: number | null | undefined;
  format: (v: number | null) => string;
  ms?: number;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<number | null>(value ?? null);
  const from = useRef<number>(value ?? 0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (value === null || value === undefined) {
      setShown(null);
      return;
    }
    if (reduced) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (a === b) {
      setShown(b);
      return;
    }
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // easeOutCubic: fast then settling, which reads as "arriving at a value"
      // rather than as a value being generated.
      const e = 1 - Math.pow(1 - t, 3);
      setShown(a + (b - a) * e);
      if (t < 1) {
        raf.current = requestAnimationFrame(step);
      } else {
        from.current = b;
      }
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [value, ms, reduced]);

  return (
    <span className={`tabular-nums ${className}`}>
      {format(shown === null ? null : Math.round(shown))}
    </span>
  );
}

/* ------------------------------------------------------------------- delta */

/** Change across the visible window. Silent when there is nothing to compare. */
export function Delta({ samples, format }: { samples: Sample[]; format?: (n: number) => string }) {
  const values = samples.map((s) => s.v).filter((v): v is number => v !== null);
  if (values.length < 3) return null;
  const change = values[values.length - 1] - values[0];
  if (change === 0) return null;
  const up = change > 0;
  const fmt = format ?? ((n: number) => Math.abs(n).toLocaleString('en-ZA'));
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
        up ? 'bg-[#38BDF8]/10 text-[#38BDF8]' : 'bg-[#64748B]/10 text-[#94A3B8]'
      }`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {fmt(change)}
      {/* "in view" rather than "this window": shorter, so the badge stays on
          one line beside a long label at 360dp, and more accurate — it is the
          change across the samples currently drawn, nothing wider. */}
      <span className="font-normal opacity-70">in view</span>
    </span>
  );
}

/* -------------------------------------------------------------- area chart */

/**
 * The workhorse: a gradient-filled line that draws itself in once, then
 * updates in place.
 *
 * Gaps break the path exactly as `Sparkline` does — a straight line through a
 * null is a claim that nothing happened during it, which is precisely what we
 * do not know. The gradient stops at the same place the stroke does, so a gap
 * is visible as a hole in the fill too, not just a thinner line.
 */
export function AreaChart({
  samples,
  height = 120,
  stroke = CH.cyan,
  max,
  showAxis = true,
  label,
  className = '',
}: {
  samples: Sample[];
  height?: number;
  stroke?: string;
  max?: number;
  showAxis?: boolean;
  label?: string;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const id = useMemo(() => `ac${Math.random().toString(36).slice(2, 9)}`, []);
  const W = 320;
  const PAD = 6;

  const values = samples.map((s) => s.v).filter((v): v is number => v !== null);
  if (values.length < 2) {
    return (
      <div
        className={`flex items-center justify-center rounded-xl border border-dashed border-[#1E293B] text-[11px] text-slate-600 ${className}`}
        style={{ height }}
      >
        collecting samples…
      </div>
    );
  }

  /*
   * Y-SCALE, and why it is not simply [0, max].
   *
   * Most series here are CUMULATIVE COUNTERS — queries today, blocked today.
   * Anchored at zero, 131,068 → 135,100 draws as a flat line pinned to the top
   * of the frame: technically honest, and completely uninformative. Verified by
   * screenshot on 2026-08-25, where two of the three Activity charts were
   * straight lines against the ceiling.
   *
   * So: keep zero as the floor when the data genuinely lives near it (rates,
   * percentages, small counts), and zoom to the observed range only when the
   * whole series is squeezed into the top fifth of it.
   *
   * Zooming exaggerates, which is exactly the sin this product does not commit
   * — so a zoomed chart SAYS SO, printing the visible floor in the corner. The
   * reader can then see that the line spans 131k–135k rather than 0–135k, and
   * the accompanying Delta badge already gives the absolute change.
   */
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Height gate: zooming is only allowed where the "from …" label fits. A
  // short inline strip has no room for it, and an unlabelled zoomed chart
  // exaggerates silently — so those stay anchored instead.
  const zoomed =
    max === undefined && height >= 60 && dataMin > 0 && dataMax - dataMin < dataMax * 0.2;
  const pad = zoomed ? Math.max((dataMax - dataMin) * 0.25, dataMax * 0.002) : 0;

  const hi = max ?? (zoomed ? dataMax + pad : dataMax);
  const lo = zoomed ? Math.max(0, dataMin - pad) : Math.min(dataMin, 0);
  const span = hi - lo || 1;
  const stepX = W / Math.max(1, samples.length - 1);
  const y = (v: number) => height - PAD - ((v - lo) / span) * (height - PAD * 2);

  // Split into unbroken runs so both the stroke and the fill respect gaps.
  const runs: { d: string; x0: number; x1: number }[] = [];
  let pts: string[] = [];
  let x0 = 0;
  samples.forEach((s, i) => {
    const x = i * stepX;
    if (s.v === null) {
      if (pts.length > 1) runs.push({ d: pts.join(' '), x0, x1: (i - 1) * stepX });
      pts = [];
      return;
    }
    if (pts.length === 0) x0 = x;
    pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y(s.v).toFixed(1)}`);
  });
  if (pts.length > 1) runs.push({ d: pts.join(' '), x0, x1: (samples.length - 1) * stepX });

  const last = samples[samples.length - 1];

  return (
    <div className="relative w-full">
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className={`w-full overflow-visible ${className}`}
      style={{ height }}
      role="img"
      aria-label={label ?? 'recent samples'}
    >
      <defs>
        <linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {showAxis &&
        [0.25, 0.5, 0.75].map((f) => (
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

      {runs.map((r, i) => (
        <path
          key={`f${i}`}
          d={`${r.d} L${r.x1.toFixed(1)},${height} L${r.x0.toFixed(1)},${height} Z`}
          fill={`url(#${id}f)`}
        />
      ))}
      {runs.map((r, i) => (
        <path
          key={`s${i}`}
          d={r.d}
          fill="none"
          stroke={stroke}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={
            reduced
              ? undefined
              : { filter: `drop-shadow(0 0 5px ${stroke}66)` }
          }
        />
      ))}

      {/* The live head. Present only when the newest sample is a real reading —
          a pulsing dot over a gap would be the chart claiming a value it does
          not have. */}
      {last?.v !== null && last !== undefined && (
        <g transform={`translate(${((samples.length - 1) * stepX).toFixed(1)},${y(last.v).toFixed(1)})`}>
          {!reduced && (
            <circle r="3" fill={stroke} opacity="0.5">
              <animate attributeName="r" values="3;9;3" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
            </circle>
          )}
          <circle r="3" fill={stroke} />
        </g>
      )}
    </svg>
      {/* The chart admits its own axis. Without this a 3% wiggle on a counter
          looks like a cliff, which is a lie told with a true line. */}
      {zoomed && (
        <span className="pointer-events-none absolute bottom-0 left-0 font-mono text-[9px] tabular-nums text-slate-600">
          from {Math.round(lo).toLocaleString('en-ZA')}
        </span>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- bar chart */

/**
 * Ranked horizontal bars — for "which of these is biggest", where a trend line
 * would say nothing. Widths transition; a null count renders the dash and no
 * bar at all rather than a zero-width one, because those look identical to a
 * real zero and mean something completely different.
 */
export function BarList({
  rows,
  colour = CH.cyan,
  max,
  className = '',
}: {
  rows: { label: string; value: number | null; hint?: string }[];
  colour?: string;
  max?: number;
  className?: string;
}) {
  const known = rows.map((r) => r.value).filter((v): v is number => v !== null);
  const hi = max ?? (known.length ? Math.max(...known) : 0);
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {rows.map((r) => {
        const absent = r.value === null;
        const w = absent || hi <= 0 ? 0 : Math.max(2, (r.value / hi) * 100);
        return (
          <div key={r.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] text-slate-300" title={r.label}>
                {r.label}
              </span>
              <span
                className={`shrink-0 font-mono text-[12px] tabular-nums ${absent ? 'text-slate-600' : 'text-slate-200'}`}
              >
                {absent ? DASH : r.value.toLocaleString('en-ZA')}
              </span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#0F1B2D]">
              {!absent && (
                <div
                  className="h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{
                    width: `${w}%`,
                    background: `linear-gradient(90deg, ${colour}66, ${colour})`,
                  }}
                />
              )}
            </div>
            {r.hint && <p className="mt-0.5 text-[10px] text-slate-600">{r.hint}</p>}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- ring gauge */

/**
 * A percentage as a sweeping ring. Null draws the empty track and the dash —
 * the ring is visibly a container with nothing in it, not a zero.
 */
export function RingGauge({
  value,
  label,
  sub,
  size = 132,
  tone = CH.cyan,
  thickness = 9,
}: {
  value: number | null;
  label?: string;
  sub?: string;
  size?: number;
  tone?: string;
  thickness?: number;
}) {
  const reduced = useReducedMotion();
  const r = size / 2 - thickness - 2;
  const circ = 2 * Math.PI * r;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const id = useMemo(() => `rg${Math.random().toString(36).slice(2, 9)}`, []);

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? 'gauge'}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.55" />
            <stop offset="100%" stopColor={tone} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={CH.grid} strokeWidth={thickness} />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${id})`}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={`${(clamped / 100) * circ} ${circ}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{
              transition: reduced ? undefined : 'stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)',
              filter: reduced ? undefined : `drop-shadow(0 0 6px ${tone}55)`,
            }}
          />
        )}
        <text
          x="50%"
          y={sub ? '46%' : '50%'}
          dominantBaseline="central"
          textAnchor="middle"
          className="font-mono tabular-nums"
          fill={value === null ? CH.muted : '#F1F5F9'}
          fontSize={size / 4.4}
        >
          {value === null ? DASH : `${Math.round(clamped)}%`}
        </text>
        {sub && (
          <text
            x="50%"
            y="63%"
            dominantBaseline="central"
            textAnchor="middle"
            className="font-mono uppercase"
            fill={CH.muted}
            fontSize={size / 13}
            letterSpacing="1.4"
          >
            {sub}
          </text>
        )}
      </svg>
      {label && (
        <p className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- live meter */

/**
 * A compact horizontal meter with a moving fill — for a single bounded value
 * that is not a percentage of a whole (temperature against its throttle point,
 * memory against installed, a budget against its cap).
 */
export function Meter({
  value,
  max,
  label,
  unit,
  format,
  tone,
}: {
  value: number | null;
  max: number;
  label: string;
  unit?: string;
  format?: (v: number | null) => string;
  tone?: string;
}) {
  const pctOf = value === null ? null : Math.max(0, Math.min(100, (value / max) * 100));
  // Colour is derived from the reading, so the bar itself carries the warning
  // rather than relying on a caller to remember to pass one.
  const colour =
    tone ?? (pctOf === null ? CH.muted : pctOf > 88 ? CH.red : pctOf > 70 ? CH.amber : CH.cyan);
  const fmt = format ?? ((v: number | null) => (v === null ? DASH : v.toLocaleString('en-ZA')));
  const shown = fmt(value);
  // Suppress a unit the formatter has already applied. Callers naturally pass
  // both — `unit="%"` reads as documentation and `pct()` is the house
  // formatter — and the result was "7.2%%" on the customer's Activity screen.
  // Catching it here fixes every call site at once and stops it recurring.
  const showUnit =
    Boolean(unit) && value !== null && !shown.trimEnd().endsWith(unit!.trim());
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-slate-500">{label}</span>
        <span
          className="font-mono text-sm tabular-nums"
          style={{ color: value === null ? CH.muted : '#E2E8F0' }}
        >
          {shown}
          {showUnit && <span className="ml-0.5 text-[11px] text-slate-500">{unit}</span>}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#0F1B2D]">
        {pctOf !== null && (
          <div
            className="h-full rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${pctOf}%`, background: `linear-gradient(90deg, ${colour}55, ${colour})` }}
          />
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- section label */

/** The site's kicker: `03 · Audit & forensics`. Free, and it sets the tone. */
export function Kicker({ index, children }: { index: string; children: React.ReactNode }) {
  return (
    <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[#38BDF8]/70">
      {index} <span className="text-slate-600">·</span>{' '}
      <span className="text-slate-500">{children}</span>
    </p>
  );
}

/* --------------------------------------------------------------- backdrop */

/**
 * The live background.
 *
 * Drifting nodes joined by short links — an edge mesh, which is literally what
 * the product is. `intensity` (0..1) comes from a REAL reading and only changes
 * how lively it looks; it never encodes a number anyone could try to read off
 * the screen. That distinction is why this is decoration and not a chart.
 *
 * Parks itself when the tab is hidden and renders a single still frame under
 * `prefers-reduced-motion`, so it costs nothing on a handset in a pocket and
 * nothing at all to someone who asked for less movement.
 */
export function LiveBackdrop({
  intensity = 0.4,
  tone = CH.blue,
  className = '',
}: {
  intensity?: number;
  tone?: string;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const visible = useVisible();
  const power = useRef(intensity);
  power.current = Math.max(0, Math.min(1, intensity));

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    type Node = { x: number; y: number; vx: number; vy: number; r: number };
    let nodes: Node[] = [];

    const seed = () => {
      const rect = cv.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Density scales with area so a tablet does not get a sparse field and a
      // small handset does not get a soup. Capped so a desktop stays cheap.
      const count = Math.min(46, Math.max(14, Math.round((w * h) / 16000)));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.16,
        vy: (Math.random() - 0.5) * 0.16,
        r: 0.8 + Math.random() * 1.4,
      }));
    };

    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      const p = power.current;
      const linkDist = 84 + p * 34;

      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 > linkDist * linkDist) continue;
          const alpha = (1 - Math.sqrt(d2) / linkDist) * (0.1 + p * 0.16);
          ctx.strokeStyle = tone;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      ctx.globalAlpha = 0.42 + p * 0.3;
      ctx.fillStyle = tone;
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = () => {
      const p = power.current;
      for (const n of nodes) {
        n.x += n.vx * (0.5 + p);
        n.y += n.vy * (0.5 + p);
        if (n.x < -10) n.x = w + 10;
        if (n.x > w + 10) n.x = -10;
        if (n.y < -10) n.y = h + 10;
        if (n.y > h + 10) n.y = -10;
      }
      draw();
      raf = requestAnimationFrame(step);
    };

    seed();
    if (reduced || !visible) {
      draw();
    } else {
      raf = requestAnimationFrame(step);
    }

    const ro = new ResizeObserver(() => {
      seed();
      draw();
    });
    ro.observe(cv);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [reduced, visible, tone]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
