/**
 * Gate^Flame mobile — phone-native primitives.
 *
 * Same palette and same honesty rules as the console (`kioskUi.tsx`), different
 * ergonomics. The console is read across a room from a fixed 1920px display;
 * this is held in one hand and scrolled with a thumb. Sharing the COMPONENTS
 * between those two would have meant every panel carrying a branch for both, so
 * what is shared is the layer below: the palette, the data client, the
 * formatters, the chart vocabulary in `kiosk/charts.tsx`, and the rule that an
 * absent number renders as a dash.
 *
 * THE RULE, RESTATED, BECAUSE IT IS THE WHOLE PRODUCT
 * Never render a value the API did not return. `null` is not `0`. Where a
 * figure is missing, show the dash and the node's own reason for the gap. That
 * survives every visual change made here — the polish is around the numbers,
 * never over them.
 *
 * ON SIZE
 *
 * There is no single "phone". This app has to look deliberate on a 360dp
 * budget handset, a 411dp flagship, a 480dp foldable half-open, and a 800dp
 * tablet — plus every one of those rotated. So NOTHING here is a fixed frame:
 * content lives in a centred column that widens by breakpoint, tiles reflow
 * from two-up to four-up, and vertical rhythm comes from `env(safe-area-*)`
 * rather than from a guessed notch height. The app this replaced drew a
 * hardcoded phone chrome and its own nav landed on top of its own content.
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
 * One scrollable screen.
 *
 * Bottom padding clears the floating tab bar; top padding clears the notch.
 * Both use env() so a real handset is respected rather than guessed at. The
 * column widens in three steps — a tablet showing a 448px ribbon of content
 * down the middle of an 800px display looks like a phone app someone forgot to
 * finish, which is exactly the "dev alpha" read we are trying to lose.
 */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-4 no-scrollbar sm:px-6"
      style={{
        paddingTop: 'calc(env(safe-area-inset-top) + 0.75rem)',
        // 7rem cleared the tab bar but NOT the assistant bubble, which floats
        // 92px above the inset and is ~64px tall - so the last row of the
        // bottom card sat underneath it and a real reading was unreadable.
        // Measured on the S10e, not guessed.
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 10rem)',
      }}
    >
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 sm:max-w-xl sm:gap-4 lg:max-w-3xl">
        {children}
      </div>
    </div>
  );
}

/**
 * Screen heading, with the site's kicker above it.
 *
 * The numbered kicker is lifted straight from ionity.co.za — `03 · Audit &
 * forensics`. It costs one line and it is most of why a screen reads as a
 * designed product rather than a debug view.
 */
export function ScreenTitle({
  title,
  sub,
  kicker,
  right,
}: {
  title: string;
  sub?: string;
  kicker?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-1 pb-1 pt-2">
      <div className="min-w-0">
        {kicker && (
          <p className="mb-1 font-mono text-[9px] uppercase tracking-[0.3em] text-[#38BDF8]/70">
            {kicker}
          </p>
        )}
        <h2 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">{title}</h2>
        {sub && <p className="mt-1 text-xs leading-relaxed text-[#64748B] sm:text-sm">{sub}</p>}
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}

/**
 * Reflowing tile grid. Two-up on a phone, four-up once there is room.
 *
 * A helper rather than a class string repeated on every screen, because the
 * moment those drift the app stops feeling like one piece of software.
 */
export function Tiles({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return (
    <div
      className={`grid gap-4 sm:gap-5 ${
        cols === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-2 lg:grid-cols-4'
      }`}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- card */

/**
 * The surface everything sits on.
 *
 * Translucent over the live backdrop rather than opaque, so the drifting mesh
 * shows faintly through and the screen reads as one composition instead of a
 * stack of boxes. `backdrop-blur` is doing the work that a drop shadow would
 * do on a light theme — shadows turn to mud on an OLED panel.
 */
export function Card({
  children,
  className = '',
  accent = 'none',
  glow = false,
}: {
  children: ReactNode;
  className?: string;
  accent?: 'none' | 'good' | 'warn' | 'fault';
  glow?: boolean;
}) {
  const ring =
    accent === 'good'
      ? 'border-[#10B981]/40'
      : accent === 'warn'
        ? 'border-[#F59E0B]/40'
        : accent === 'fault'
          ? 'border-[#E11D48]/50'
          : 'border-[#1E293B]';
  const shadow =
    glow && accent === 'good'
      ? 'shadow-[0_0_36px_-12px_rgba(16,185,129,0.5)]'
      : glow && accent === 'fault'
        ? 'shadow-[0_0_36px_-12px_rgba(225,29,72,0.5)]'
        : glow && accent === 'warn'
          ? 'shadow-[0_0_36px_-12px_rgba(245,158,11,0.45)]'
          : '';
  return (
    <div
      className={`rounded-2xl border ${ring} ${shadow} bg-[#111A28]/70 p-4 backdrop-blur-xl sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/** Card with a mono label across the top — the shape most charts want. */
export function ChartCard({
  label,
  value,
  tone = C.cyan,
  right,
  footer,
  children,
}: {
  label: string;
  value?: string;
  tone?: string;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-mono text-[10px] uppercase tracking-[0.16em] text-[#64748B]">
          {label}
        </span>
        {/* shrink-0: at 360dp a long label was pushing the badge onto a second
            line and shoving the reading out of alignment with the chart. */}
        <div className="flex shrink-0 items-baseline gap-2">
          {value && (
            <span className="font-mono text-sm tabular-nums" style={{ color: tone }}>
              {value}
            </span>
          )}
          {right}
        </div>
      </div>
      {children}
      {footer && <div className="mt-3 text-[11px] leading-relaxed text-[#64748B]">{footer}</div>}
    </Card>
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
          className={`font-mono text-2xl font-semibold tabular-nums tracking-tight sm:text-3xl ${absent ? 'text-[#475569]' : colour}`}
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

/** A small labelled pill. Used for state that is a word, not a number. */
export function Chip({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: 'slate' | 'cyan' | 'good' | 'warn' | 'fault';
}) {
  const style =
    tone === 'cyan'
      ? 'border-[#38BDF8]/40 text-[#38BDF8] bg-[#38BDF8]/10'
      : tone === 'good'
        ? 'border-[#10B981]/40 text-[#10B981] bg-[#10B981]/10'
        : tone === 'warn'
          ? 'border-[#F59E0B]/40 text-[#F59E0B] bg-[#F59E0B]/10'
          : tone === 'fault'
            ? 'border-[#E11D48]/50 text-[#E11D48] bg-[#E11D48]/10'
            : 'border-[#1E293B] text-[#94A3B8] bg-[#0F1B2D]/70';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${style}`}
    >
      {children}
    </span>
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
      className={`rounded-2xl border px-4 py-3 backdrop-blur-xl ${
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

/**
 * The scrolling capability strip from ionity.co.za.
 *
 * Purely typographic — it names capabilities, it never carries a figure, so
 * there is nothing here that could be mistaken for a reading. Pauses under
 * `prefers-reduced-motion` via the CSS class rather than JS, because it has no
 * other reason to exist at runtime.
 */
export function Marquee({ items }: { items: string[] }) {
  const doubled = [...items, ...items];
  return (
    <div className="relative overflow-hidden py-1" aria-hidden="true">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[#080D16] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[#080D16] to-transparent" />
      <div className="gf-marquee flex w-max gap-2">
        {doubled.map((t, i) => (
          <span
            key={`${t}-${i}`}
            className="whitespace-nowrap rounded-full border border-[#1E293B] bg-[#0F1B2D]/60 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[#475569]"
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
