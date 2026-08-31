/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: presentation primitives
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Every primitive here takes `number | null` and renders `—` for null. That is
 * the whole design: the honest case is the DEFAULT path through each component,
 * not a branch someone has to remember to write. A caller cannot accidentally
 * render a fabricated zero, because there is nowhere to put one.
 *
 * Charts are hand-rolled SVG rather than Recharts. Recharts is already a
 * dependency, but it is 391 kB of the mobile bundle and this screen redraws on
 * a Pi 5 driving 1920×1080 over HDMI. Six hundred bytes of path arithmetic
 * costs nothing and drops no frames.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DASH, type Sample } from './kioskClient';

export const COLORS = {
  bg: '#080D16',
  card: '#111A28',
  border: '#1E293B',
  chip: '#0F1B2D',
  cyan: '#38BDF8',
  blue: '#006FD3',
  orange: '#FF8700',
  running: '#10B981',
  degraded: '#F59E0B',
  stopped: '#64748B',
  fault: '#E11D48',
  muted: '#475569',
} as const;

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

export function Card({
  title,
  subtitle,
  right,
  accent,
  className = '',
  children,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  accent?: 'none' | 'warn' | 'fault' | 'good';
  className?: string;
  children: ReactNode;
}) {
  const ring =
    accent === 'warn'
      ? 'border-[#F59E0B]/40 bg-[#F59E0B]/[0.04]'
      : accent === 'fault'
        ? 'border-[#E11D48]/50 bg-[#E11D48]/[0.05]'
        : accent === 'good'
          ? 'border-[#10B981]/30 bg-[#10B981]/[0.03]'
          : 'border-[#1E293B] bg-[#111A28]/80';

  return (
    <section className={`rounded-2xl border backdrop-blur-md p-6 ${ring} ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 mb-5">
          <div>
            {title && <h3 className="text-lg font-semibold text-slate-100 tracking-tight">{title}</h3>}
            {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-prose">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * The node's own words about why a number is missing. Rendered verbatim —
 * paraphrasing a gap is how "Pi-hole unreachable" becomes "no data yet" becomes
 * a customer who thinks their box is fine.
 */
export function GapNote({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <p className="mt-2 flex items-start gap-2 text-sm text-[#F59E0B] leading-snug">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F59E0B]" />
      <span>{text}</span>
    </p>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#1E293B] py-10 px-6 text-center">
      <p className="text-base font-medium text-slate-300">{title}</p>
      {detail && <p className="mt-1.5 text-sm text-slate-500 max-w-md">{detail}</p>}
    </div>
  );
}

/** Shimmer, never fake digits — see the rebuild prompt's one rule. */
export function Skeleton({ className = 'h-8 w-32' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-[#1E293B]/70 ${className}`} />;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function StatTile({
  label,
  value,
  unit,
  gap,
  tone = 'default',
  series,
  loading,
}: {
  label: string;
  value: string;
  unit?: string;
  gap?: string | null;
  tone?: 'default' | 'good' | 'warn' | 'fault';
  series?: Sample[];
  loading?: boolean;
}) {
  const colour =
    tone === 'good'
      ? 'text-[#10B981]'
      : tone === 'warn'
        ? 'text-[#F59E0B]'
        : tone === 'fault'
          ? 'text-[#E11D48]'
          : value === DASH
            ? 'text-slate-600'
            : 'text-slate-100';

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 p-5">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      {loading ? (
        <Skeleton className="mt-3 h-9 w-24" />
      ) : (
        <p className={`mt-2 font-mono text-4xl tabular-nums leading-none ${colour}`}>
          {value}
          {unit && value !== DASH && <span className="ml-1 text-lg text-slate-500">{unit}</span>}
        </p>
      )}
      {series && series.length > 1 && (
        <Sparkline samples={series} height={34} className="mt-3" stroke={COLORS.cyan} />
      )}
      <GapNote text={gap} />
    </div>
  );
}

const STATUS_STYLE: Record<string, { dot: string; text: string; label: string }> = {
  running: { dot: 'bg-[#10B981]', text: 'text-[#10B981]', label: 'Running' },
  degraded: { dot: 'bg-[#F59E0B]', text: 'text-[#F59E0B]', label: 'Degraded' },
  stopped: { dot: 'bg-[#64748B]', text: 'text-[#64748B]', label: 'Stopped' },
  not_implemented: { dot: 'bg-[#64748B]', text: 'text-[#64748B]', label: 'Not built' },
  starting: { dot: 'bg-[#38BDF8]', text: 'text-[#38BDF8]', label: 'Starting' },
  stopping: { dot: 'bg-[#38BDF8]', text: 'text-[#38BDF8]', label: 'Stopping' },
  failed: { dot: 'bg-[#E11D48]', text: 'text-[#E11D48]', label: 'Failed' },
};

/**
 * A module carrying a gap never shows green — enforced here rather than left to
 * each caller, because "never render a green indicator next to a module that
 * carries a gap" is a promise the product makes, and promises belong in one
 * place where they can be tested.
 */
export function StatusPill({ status, hasGap }: { status: string; hasGap?: boolean }) {
  const effective = hasGap && status === 'running' ? 'degraded' : status;
  const s = STATUS_STYLE[effective] ?? STATUS_STYLE.stopped;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[#1E293B] bg-[#080D16]/60 px-3 py-1">
      <span className={`h-2 w-2 rounded-full ${s.dot}`} />
      <span className={`text-xs font-semibold uppercase tracking-wider ${s.text}`}>{s.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

/**
 * A line over real samples. Nulls break the path rather than joining across
 * them: a straight line drawn through a gap is a claim that nothing happened
 * during it, which is exactly what we do not know.
 */
export function Sparkline({
  samples,
  height = 60,
  width = 240,
  stroke = COLORS.cyan,
  fill = true,
  max,
  className = '',
}: {
  samples: Sample[];
  height?: number;
  width?: number;
  stroke?: string;
  fill?: boolean;
  max?: number;
  className?: string;
}) {
  const values = samples.map((s) => s.v).filter((v): v is number => v !== null);
  if (values.length < 2) {
    return (
      /* Same reasoning as charts.tsx: show the wait, don't caption it. */
      <div
        className={`overflow-hidden rounded-lg ${className}`}
        style={{ height }}
        role="img"
        aria-label="Not enough samples to draw this yet"
      >
        <div className="gf-shimmer h-full w-full opacity-30" />
      </div>
    );
  }

  const hi = max ?? Math.max(...values);
  const lo = Math.min(...values, 0);
  const span = hi - lo || 1;
  const stepX = width / Math.max(1, samples.length - 1);
  const y = (v: number) => height - ((v - lo) / span) * (height - 4) - 2;

  const segments: string[] = [];
  let current: string[] = [];
  samples.forEach((s, i) => {
    if (s.v === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(`${current.length === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${y(s.v).toFixed(1)}`);
  });
  if (current.length > 1) segments.push(current.join(' '));

  const areaBase = samples.length > 0 ? `L${width},${height} L0,${height} Z` : '';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${className}`}
      style={{ height }}
      role="img"
      aria-label="recent samples"
    >
      {fill && segments.length === 1 && (
        <path d={`${segments[0]} ${areaBase}`} fill={stroke} opacity={0.1} />
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

/** Donut for a percentage. Null renders as an unfilled ring plus an em-dash. */
export function Gauge({
  value,
  label,
  size = 150,
  tone = COLORS.cyan,
}: {
  value: number | null;
  label?: string;
  size?: number;
  tone?: string;
}) {
  const r = size / 2 - 12;
  const circumference = 2 * Math.PI * r;
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label ?? 'gauge'}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={COLORS.border} strokeWidth={10} />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={10}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dasharray 700ms ease' }}
          />
        )}
        <text
          x="50%"
          y="50%"
          dominantBaseline="central"
          textAnchor="middle"
          className="font-mono tabular-nums"
          fill={value === null ? COLORS.muted : '#F1F5F9'}
          fontSize={size / 4.2}
        >
          {value === null ? DASH : `${Math.round(value)}%`}
        </text>
      </svg>
      {label && <p className="mt-2 text-xs uppercase tracking-[0.14em] text-slate-500">{label}</p>}
    </div>
  );
}

/** Horizontal proportion bar. Used where a ratio matters more than a trend. */
export function ProportionBar({
  parts,
}: {
  parts: { label: string; value: number | null; colour: string }[];
}) {
  const total = parts.reduce((sum, p) => sum + (p.value ?? 0), 0);
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[#0F1B2D]">
        {total > 0 &&
          parts.map((p) => (
            <div
              key={p.label}
              style={{ width: `${((p.value ?? 0) / total) * 100}%`, backgroundColor: p.colour }}
              className="transition-all duration-700"
            />
          ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
        {parts.map((p) => (
          <span key={p.label} className="flex items-center gap-2 text-sm text-slate-400">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.colour }} />
            {p.label}
            <span className="font-mono tabular-nums text-slate-200">{p.value === null ? DASH : p.value.toLocaleString()}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Every chart carries this. It is the E6 gap, stated on the glass. */
export function SinceNote({ since, extra }: { since: number; extra?: string }) {
  return (
    <p className="mt-3 text-xs text-slate-600">
      Live samples since {new Date(since).toLocaleTimeString('en-ZA', { hour12: false })} — this screen keeps no
      stored history{extra ? `. ${extra}` : '.'}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      // 44px minimum touch target — this is operated by a fingertip on a wall
      // panel, sometimes by someone standing on a chair.
      className={`relative h-11 w-20 shrink-0 rounded-full border transition-colors duration-300 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? 'border-[#38BDF8] bg-[#38BDF8]/25' : 'border-[#1E293B] bg-[#0F1B2D]'
      }`}
    >
      <span
        className={`absolute top-1 h-8 w-8 rounded-full transition-all duration-300 ${
          checked ? 'left-10 bg-[#38BDF8] shadow-[0_0_18px_rgba(56,189,248,0.6)]' : 'left-1 bg-[#475569]'
        }`}
      />
    </button>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T | null;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}>
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o.id)}
            className={`rounded-xl border px-4 py-4 text-left transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? 'border-2 border-[#38BDF8] bg-[#38BDF8]/10 shadow-[0_0_24px_rgba(56,189,248,0.25)]'
                : 'border-[#1E293B] bg-[#0F1B2D]/60 hover:border-[#334155]'
            }`}
          >
            <span className={`block text-base font-semibold ${active ? 'text-[#38BDF8]' : 'text-slate-200'}`}>
              {o.label}
            </span>
            {o.hint && <span className="mt-1 block text-sm leading-snug text-slate-500">{o.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Press and hold to confirm.
 *
 * The console has no keyboard and no password — authority here is physical
 * presence, granted by a loopback socket. A hold is the honest analogue of that
 * on the glass: it cannot be triggered by a sleeve brushing the panel, and it
 * is one continuous, cancellable act rather than a modal a passer-by clicks
 * through. Used for anything that removes protection or removes access.
 */
export function HoldButton({
  label,
  holdingLabel,
  onConfirm,
  tone = 'danger',
  ms = 1500,
  disabled,
  className = '',
}: {
  label: string;
  holdingLabel?: string;
  onConfirm: () => void;
  tone?: 'danger' | 'primary';
  ms?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    setProgress(0);
  }, []);

  useEffect(() => stop, [stop]);

  const begin = () => {
    if (disabled) return;
    start.current = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start.current) / ms);
      setProgress(p);
      if (p >= 1) {
        stop();
        onConfirm();
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const base =
    tone === 'danger'
      ? 'border-[#E11D48]/50 text-[#E11D48] hover:border-[#E11D48]'
      : 'border-[#38BDF8]/50 text-[#38BDF8] hover:border-[#38BDF8]';

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={begin}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className={`relative min-h-11 overflow-hidden rounded-xl border bg-[#0F1B2D] px-5 py-3 text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${base} ${className}`}
    >
      <span
        className="absolute inset-y-0 left-0 bg-current opacity-20 transition-none"
        style={{ width: `${progress * 100}%` }}
      />
      <span className="relative">{progress > 0 ? (holdingLabel ?? 'Keep holding…') : label}</span>
    </button>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone = 'primary',
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'ghost';
  className?: string;
}) {
  const style =
    tone === 'primary'
      ? 'bg-[#006FD3] text-white hover:bg-[#0059a8] shadow-[0_0_20px_rgba(0,111,211,0.3)] border-transparent'
      : 'border-[#1E293B] bg-[#0F1B2D] text-slate-300 hover:border-[#334155]';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-11 rounded-xl border px-5 py-3 text-sm font-semibold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${style} ${className}`}
    >
      {children}
    </button>
  );
}

/** Shown wherever a write is offered to a page that cannot perform one. */
export function ViewerNotice({ what }: { what: string }) {
  return (
    <p className="rounded-lg border border-[#1E293B] bg-[#0F1B2D]/60 px-4 py-3 text-sm text-slate-400">
      <span className="font-semibold text-slate-300">Read-only view.</span> {what} can only be changed at the
      appliance itself or from a paired phone — the node grants control from a loopback connection, which this
      page does not have.
    </p>
  );
}

/**
 * The state a browser on the LAN actually lands in.
 *
 * Measured against the live node at 192.168.0.10 on 2026-08-17: of the routes
 * this console uses, ONLY `/system/status` and `/system/kiosk` answer a LAN
 * request — those two are LAN-gated. `/telemetry/summary`, `/filtering`,
 * `/services`, `/clients`, `/threats/recent`, `/pair/devices`,
 * `/firewall/bounced`, `/wan/summary`, `/flows/recent` and `/posture/audit`
 * every one returned **401**. Reads need `read` scope, and scope comes from a
 * loopback socket or a paired token — neither of which a LAN browser has.
 *
 * So "read-only viewer" was the wrong model: there is nothing to read. Without
 * this screen the console would render eight tabs of em-dashes and look broken
 * rather than look refused, and the first instinct would be to go hunting for a
 * fault in the agent that isn't there.
 */
export function NotTheConsole({ nodeId, kioskPath }: { nodeId: string | null; kioskPath: string | null }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card accent="warn" className="max-w-2xl">
        <h2 className="text-3xl font-semibold text-slate-100">This is not the appliance console</h2>
        <p className="mt-4 leading-relaxed text-slate-400">
          The node answered, so it is running and reachable — but it refused every request for data. Scope is
          granted to a connection from the appliance itself, or to a phone that has been paired. A browser on the
          network has neither, so there is nothing here to show you. That is the security model working, not a
          fault.
        </p>
        <div className="mt-6 rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 p-5">
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">To see this data</p>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li>· Look at the screen attached to the appliance — that console reaches the agent over loopback.</li>
            <li>· Or pair a phone from that console, and use the Gate^Flame app.</li>
          </ul>
        </div>
        <p className="mt-5 font-mono text-xs text-slate-600">
          node {nodeId ?? DASH} · kiosk served at {kioskPath ?? DASH} · reads refused with HTTP 401
        </p>
      </Card>
    </div>
  );
}
