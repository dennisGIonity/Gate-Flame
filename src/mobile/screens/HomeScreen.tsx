/**
 * Home — the one screen that answers "is my family safe online right now?"
 *
 * A customer opens this, looks for two seconds, and closes it. So the hero
 * carries exactly one message and the numbers underneath support it. Anything
 * that needs reading twice belongs on another tab.
 *
 * Four states, and they must be visually unmistakable from each other:
 *
 *   protected     the box is filtering              green
 *   paused        the owner switched it off         amber - a CHOICE
 *   unprotected   the box failed                    red   - a FAULT
 *   unknown       we cannot reach the box           slate - not a claim
 *
 * The last one matters most. After deployment nobody sees the console again, so
 * if this app cannot tell the difference between "fine" and "cannot ask", the
 * customer has no way to find out either.
 */

import { Suspense, lazy } from 'react';
import { ShieldCheck, ShieldOff, ShieldAlert, HelpCircle } from 'lucide-react';

import type { FilteringState } from '../../types/filtering';
import {
  DASH,
  num,
  pct,
  useSeries,
  type Polled,
  type TelemetrySummary,
} from '../../components/kiosk/kioskClient';
import { Sparkline } from '../../components/kiosk/kioskUi';
import { Card, Gap, Metric, Screen, Warning } from '../mobileUi';

const GravityParticleCanvas = lazy(() =>
  import('../../components/GravityParticleCanvas').then((m) => ({
    default: m.GravityParticleCanvas,
  })),
);

type Status = 'protected' | 'paused' | 'unprotected' | 'unknown';

const LOOK: Record<
  Status,
  { icon: typeof ShieldCheck; title: string; sub: string; ring: string; text: string }
> = {
  protected: {
    icon: ShieldCheck,
    title: 'Protected',
    sub: 'Your box is filtering everything your router asks it about.',
    ring: 'border-[#10B981]/50',
    text: 'text-[#10B981]',
  },
  paused: {
    icon: ShieldOff,
    title: 'Paused by you',
    sub: 'Nothing is being blocked until you turn protection back on.',
    ring: 'border-[#F59E0B]/50',
    text: 'text-[#F59E0B]',
  },
  unprotected: {
    icon: ShieldAlert,
    title: 'Not protecting you',
    sub: 'Your internet still works, but nothing is being filtered right now.',
    ring: 'border-[#E11D48]/60',
    text: 'text-[#E11D48]',
  },
  unknown: {
    icon: HelpCircle,
    title: 'Cannot reach your box',
    sub: 'Your internet is fine. This phone just cannot see the box to ask.',
    ring: 'border-[#1E293B]',
    text: 'text-slate-400',
  },
};

/**
 * Map the node's own vocabulary onto the four customer-facing states.
 *
 * Deliberately NOT a pass-through of protectionStatus: the agent distinguishes
 * `degraded`, `unconfigured` and `bypass` because an engineer needs to know
 * which, and a customer needs to know only that they are not protected. The
 * distinction is preserved in the warning underneath, where it can be read as
 * an explanation rather than as a status they have to decode.
 */
export function statusOf(filtering: FilteringState | null, reachable: boolean): Status {
  if (!reachable || !filtering) return 'unknown';
  switch (filtering.protectionStatus) {
    case 'active':
      return 'protected';
    case 'paused':
      return 'paused';
    default:
      return 'unprotected';
  }
}

export function HomeScreen({
  telemetry,
  filtering,
}: {
  telemetry: Polled<TelemetrySummary>;
  filtering: Polled<FilteringState>;
}) {
  const t = telemetry.data;
  const f = filtering.data;
  const reachable = !telemetry.error?.unreachable;
  const status = statusOf(f, reachable);
  const look = LOOK[status];
  const Icon = look.icon;

  // Blocked-per-poll, so the hero animation reacts to real traffic rather than
  // to a timer. A null sample breaks the line instead of being drawn as zero.
  const blocked = useSeries(t?.queriesBlockedToday ?? null);

  return (
    <Screen>
      {/* ---------------------------------------------------------- hero */}
      <div className={`overflow-hidden rounded-3xl border ${look.ring} bg-[#111A28]/80`}>
        {/* Verdict first, and on its own. The gravity field carries its own
            caption and legend, so text laid OVER it collided with them - the
            two fought for the same pixels on the first run. It sits underneath
            instead, where it is decoration rather than a competing headline. */}
        <div className="flex flex-col items-center px-5 pb-4 pt-8 text-center">
          <Icon className={`h-12 w-12 ${look.text}`} strokeWidth={1.5} />
          <h1 className={`mt-3 text-2xl font-semibold tracking-tight ${look.text}`}>{look.title}</h1>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-300">{look.sub}</p>

          {status === 'protected' && (
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[#64748B]">
              {num(t?.queriesBlockedToday)} blocked today
            </p>
          )}
        </div>

        <div className="h-44 border-t border-[#1E293B]/60">
          <Suspense fallback={null}>
            <GravityParticleCanvas
              isPaused={status !== 'protected'}
              threatFeed={[]}
              blockPercentage={t?.blockPercentage ?? 0}
            />
          </Suspense>
        </div>
      </div>

      {/* ------------------------------------------------- why, if not fine */}
      {status === 'unprotected' && (
        <Warning
          tone="fault"
          title="Nothing is being filtered"
          detail={
            f?.lastError ??
            'The box is reachable but is not blocking anything. Open Help and I will walk through it.'
          }
        />
      )}
      {status === 'unknown' && (
        <Warning
          title="I cannot see your box from this phone"
          detail="Check you are on your home Wi-Fi rather than mobile data. If the box is switched off, your internet keeps working but nothing is being filtered."
        />
      )}

      {/* ------------------------------------------------------- headline */}
      <Card>
        <div className="grid grid-cols-2 gap-5">
          <Metric label="Looked up today" value={num(t?.totalQueriesToday)} />
          <Metric
            label="Blocked today"
            value={num(t?.queriesBlockedToday)}
            tone={t?.queriesBlockedToday ? 'accent' : 'default'}
          />
          <Metric label="Blocked share" value={pct(t?.blockPercentage)} />
          <Metric label="Devices seen" value={num(t?.activeClientsCount)} />
        </div>
        {/* The agent names its own gaps. We render the sentence, never a guess. */}
        <Gap text={f?.lastError} />
      </Card>

      {/* ---------------------------------------------------------- trend */}
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            Blocked, while you have been watching
          </span>
          <span className="font-mono text-xs tabular-nums text-[#38BDF8]">
            {t ? num(t.queriesBlockedToday) : DASH}
          </span>
        </div>
        <Sparkline samples={blocked.samples} height={64} />
        <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
          This is live, not a history. Your box does not keep yesterday yet, so the line starts
          when you open the app.
        </p>
      </Card>
    </Screen>
  );
}
