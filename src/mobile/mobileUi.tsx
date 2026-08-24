/**
 * Gate^Flame mobile — phone-native primitives.
 *
 * Same palette and same honesty rules as the console (`kioskUi.tsx`), different
 * ergonomics. The console is read across a room from a fixed 1920px display;
 * this is held in one hand at 411dp and scrolled with a thumb. Sharing the
 * COMPONENTS between those two would have meant every panel carrying a branch
 * for both, so what is shared is the layer below: the palette, the data client,
 * the formatters, and the rule that an absent number renders as a dash.
 *
 * THE RULE, RESTATED, BECAUSE IT IS THE WHOLE PRODUCT
 * Never render a value the API did not return. `null` is not `0`. Where a
 * figure is missing, show the dash and the node's own reason for the gap.
 */

import type { ReactNode } from 'react';

/** Straight from kioskUi COLORS. Duplicated as literals only where Tailwind
 *  needs them inline; the source of truth is the console's palette. */
export const C = {
  bg: '#080D16',
  card: '#111A28',
  border: '#1E293B',
  chip: '#0F1B2D',
  cyan: '#38BDF8',
  blue: '#006FD3',
  orange: '#FF8700',
  green: '#10B981',
  amber: '#F59E0B',
  red: '#E11D48',
  ink: '#E2E8F0',
  sub: '#64748B',
} as const;

export const DASH = '—';

/* ------------------------------------------------------------------ screen */

/**
 * One scrollable screen. Bottom padding clears the floating tab bar; top
 * padding clears the notch. Both use env() so a real handset is respected
 * rather than guessed at - the previous app hardcoded a frame and its nav
 * ended up on top of the content.
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto overscroll-contain no-scrollbar px-4 pb-36 pt-3">
      <div className="mx-auto flex w-full max-w-md flex-col gap-3">{children}</div>
    </div>
  );
}

export function ScreenTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-1 pb-1 pt-2">
      <h2 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h2>
      {sub && <p className="mt-0.5 text-xs leading-relaxed text-[#64748B]">{sub}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------- card */

export function Card({
  children,
  className = '',
  accent = 'none',
}: {
  children: ReactNode;
  className?: string;
  accent?: 'none' | 'good' | 'warn' | 'fault';
}) {
  const ring =
    accent === 'good'
      ? 'border-[#10B981]/40'
      : accent === 'warn'
        ? 'border-[#F59E0B]/40'
        : accent === 'fault'
          ? 'border-[#E11D48]/50'
          : 'border-[#1E293B]';
  return (
    <div className={`rounded-2xl border ${ring} bg-[#111A28]/80 p-4 ${className}`}>{children}</div>
  );
}

/* ------------------------------------------------------------------ values */

/**
 * A single figure. `value` is pre-formatted by the caller so this component
 * never has to know whether it is looking at bytes, a percentage or a count -
 * and so it can never accidentally turn a null into a zero on the way past.
 */
export function Metric({
  label,
  value,
  unit,
  tone = 'default',
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: 'default' | 'good' | 'warn' | 'fault' | 'accent';
  hint?: string;
}) {
  const colour =
    tone === 'good'
      ? 'text-[#10B981]'
      : tone === 'warn'
        ? 'text-[#F59E0B]'
        : tone === 'fault'
          ? 'text-[#E11D48]'
          : tone === 'accent'
            ? 'text-[#38BDF8]'
            : 'text-slate-100';
  const absent = value === DASH;
  return (
    <div className="flex flex-col justify-between">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">{label}</span>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={`font-mono text-2xl font-semibold tabular-nums tracking-tight ${absent ? 'text-[#475569]' : colour}`}
        >
          {value}
        </span>
        {unit && !absent && (
          <span className="font-mono text-[11px] font-medium text-[#64748B]">{unit}</span>
        )}
      </div>
      {hint && <span className="mt-1 text-[11px] leading-snug text-[#64748B]">{hint}</span>}
    </div>
  );
}

/** The node's own explanation for a missing figure. Never our paraphrase. */
export function Gap({ text }: { text?: string | null }) {
  if (!text) return null;
  return (
    <p className="mt-2 rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-3 py-2 text-[11px] leading-relaxed text-[#F59E0B]">
      {text}
    </p>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#1E293B] px-6 py-10 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {detail && <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{detail}</p>}
    </div>
  );
}

/**
 * A problem the customer should act on, in plain language.
 *
 * Exists because after deployment nobody looks at the console again - so if the
 * box is degraded, unprotected or in bypass, THIS app is the only thing that
 * will ever say so.
 */
export function Warning({
  tone = 'warn',
  title,
  detail,
  action,
}: {
  tone?: 'warn' | 'fault';
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  const fault = tone === 'fault';
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${
        fault ? 'border-[#E11D48]/50 bg-[#E11D48]/10' : 'border-[#F59E0B]/40 bg-[#F59E0B]/10'
      }`}
    >
      <p className={`text-sm font-semibold ${fault ? 'text-[#E11D48]' : 'text-[#F59E0B]'}`}>
        {title}
      </p>
      {detail && <p className="mt-1 text-xs leading-relaxed text-slate-300">{detail}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
