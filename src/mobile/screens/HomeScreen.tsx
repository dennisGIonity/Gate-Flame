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
 *
 * On the polish: the ring sweeps, the counters ease, the gravity field drifts.
 * None of that is allowed to invent a reading — `AnimatedNumber` short-circuits
 * on null before its animation exists, and the ring draws an empty track with a
 * dash in the middle. Motion is how a value ARRIVES, never how one is produced.
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
import {
  AnimatedNumber,
  AreaChart,
  CH,
  Delta,
  RingGauge,
} from '../../components/kiosk/charts';
import { Card, ChartCard, Gap, Marquee, Metric, Screen, Warning } from '../mobileUi';

const GravityParticleCanvas = lazy(() =>
  import('../../components/GravityParticleCanvas').then((m) => ({
    default: m.GravityParticleCanvas,
  })),
);

type Status = 'protected' | 'paused' | 'unprotected' | 'unknown';

const LOOK: Record<
  Status,
  {
    icon: typeof ShieldCheck;
    title: string;
    sub: string;
    ring: string;
    text: string;
    accent: 'good' | 'warn' | 'fault' | 'none';
    tone: string;
  }
> = {
  protected: {
    icon: ShieldCheck,
    title: 'Protected',
    sub: 'Your box is filtering everything your router asks it about.',
    ring: 'border-[#10B981]/50',
    text: 'text-[#10B981]',
    accent: 'good',
    tone: CH.green,
  },
  paused: {
    icon: ShieldOff,
    title: 'Paused by you',
    sub: 'Nothing is being blocked until you turn protection back on.',
    ring: 'border-[#F59E0B]/50',
    text: 'text-[#F59E0B]',
    accent: 'warn',
    tone: CH.amber,
  },
  unprotected: {
    icon: ShieldAlert,
    title: 'Not protecting you',
    sub: 'Your internet still works, but nothing is being filtered right now.',
    ring: 'border-[#E11D48]/60',
    text: 'text-[#E11D48]',
    accent: 'fault',
    tone: CH.red,
  },
  unknown: {
    icon: HelpCircle,
    title: 'Cannot reach your box',
    sub: 'Your internet is fine. This phone just cannot see the box to ask.',
    ring: 'border-[#1E293B]',
    text: 'text-slate-400',
    accent: 'none',
    tone: CH.muted,
  },
};

/** The capability strip from ionity.co.za. Words only — never a figure. */
const CAPABILITIES = [
  'DNS filtering',
  'Threat lists',
  'Edge node',
  'On-device',
  'No cloud account',
  'Native-AI',
  'Building tomorrow, today',
];

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
  const share = useSeries(t?.blockPercentage ?? null);

  return (
    <Screen>
      {/* ---------------------------------------------------------- hero */}
      <div
        className={`overflow-hidden rounded-3xl border ${look.ring} bg-[#111A28]/70 backdrop-blur-xl`}
      >
        {/* Verdict first, and on its own. The gravity field carries its own
            caption and legend, so text laid OVER it collided with them - the
            two fought for the same pixels on the first run. It sits underneath
            instead, where it is decoration rather than a competing headline. */}
        <div className="flex flex-col items-center px-5 pb-4 pt-7 text-center sm:pt-9">
          <div className="relative">
            {/* A soft halo behind the glyph, tinted by the verdict. Pure CSS,
                so it costs nothing and it is what makes the four states read
                as different MOODS rather than four differently-coloured
                icons. */}
            <span
              aria-hidden
              className="absolute inset-0 -z-10 rounded-full blur-2xl"
              style={{ backgroundColor: look.tone, opacity: status === 'unknown' ? 0.1 : 0.28 }}
            />
            <Icon className={`h-12 w-12 sm:h-14 sm:w-14 ${look.text}`} strokeWidth={1.5} />
          </div>
          <h1
            className={`mt-3 text-2xl font-semibold tracking-tight sm:text-3xl ${look.text}`}
          >
            {look.title}
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-300">{look.sub}</p>

          {status === 'protected' && (
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[#64748B]">
              <AnimatedNumber value={t?.queriesBlockedToday ?? null} format={(v) => num(v)} /> blocked
              today
            </p>
          )}
        </div>

        {/* Taller on a bigger screen — on a tablet a 176px band under a hero
            reads as a rendering accident rather than as a deliberate field. */}
        <div className="h-44 border-t border-[#1E293B]/60 sm:h-56">
          <Suspense fallback={null}>
            {/* `?? null`, not `?? 0`. The canvas renders this figure in its own
                legend, so coercing a missing reading to zero would put a
                confident "0.0%" on the home screen for a box we cannot reach —
                the exact substitution this product refuses everywhere else. */}
            <GravityParticleCanvas
              isPaused={status !== 'protected'}
              threatFeed={[]}
              blockPercentage={t?.blockPercentage ?? null}
            />
          </Suspense>
        </div>
      </div>

      <Marquee items={CAPABILITIES} />

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

      {/* ------------------------------------------------ share, as a ring */}
      <Card accent={look.accent} glow>
        <div className="flex items-center gap-5">
          <RingGauge
            value={t?.blockPercentage ?? null}
            sub="blocked"
            tone={status === 'protected' ? CH.orange : CH.muted}
            size={116}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-200">Share of lookups refused</p>
            <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
              Ads, trackers and known-bad addresses your devices asked for and did not get. A low
              number on a quiet network is normal — a number that never moves is not.
            </p>
            <div className="mt-3">
              <AreaChart
                samples={share.samples}
                height={38}
                stroke={CH.cyan}
                max={100}
                showAxis={false}
                label="blocked share"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------- headline */}
      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
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
      <ChartCard
        label="Blocked, while you have been watching"
        value={t ? num(t.queriesBlockedToday) : DASH}
        tone={CH.orange}
        right={<Delta samples={blocked.samples} />}
        footer="This is live, not a history. Your box does not keep yesterday yet, so the line starts when you open the app."
      >
        <AreaChart samples={blocked.samples} height={104} stroke={CH.orange} label="blocked today" />
      </ChartCard>
    </Screen>
  );
}
