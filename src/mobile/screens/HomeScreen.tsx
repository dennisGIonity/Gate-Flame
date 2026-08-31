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
import { Card, ChartCard, Gap, Metric, Pulse, Screen, Skeleton, Warning } from '../mobileUi';

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
  // Subs are deliberately fragments, not sentences. The owner reads this
  // screen for two seconds; a paragraph under a one-word verdict is a
  // paragraph nobody finishes. The FULL explanation still exists - it moved
  // into the warning card below, where it only appears when something is
  // actually wrong and there is a reason to read it.
  protected: {
    icon: ShieldCheck,
    title: 'Protected',
    sub: '',
    ring: 'border-[#10B981]/50',
    text: 'text-[#10B981]',
    accent: 'good',
    tone: CH.green,
  },
  paused: {
    icon: ShieldOff,
    title: 'Paused by you',
    sub: 'Nothing is being blocked',
    ring: 'border-[#F59E0B]/50',
    text: 'text-[#F59E0B]',
    accent: 'warn',
    tone: CH.amber,
  },
  unprotected: {
    icon: ShieldAlert,
    title: 'Not filtering',
    sub: 'Your internet still works',
    ring: 'border-[#E11D48]/60',
    text: 'text-[#E11D48]',
    accent: 'fault',
    tone: CH.red,
  },
  unknown: {
    icon: HelpCircle,
    title: 'Cannot see your box',
    sub: 'Your internet is fine',
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
            {/* The halo now BREATHES when the box is healthy and sits still
                when it is not. That single difference does the job a sentence
                used to: a live, well screen versus a stopped one, read before
                a single word. It encodes no quantity - only which of the four
                states we are in, which the colour already says. */}
            <span
              aria-hidden
              className={`absolute inset-0 -z-10 rounded-full blur-2xl ${
                status === 'protected' ? 'gf-breathe' : ''
              }`}
              style={{ backgroundColor: look.tone, opacity: status === 'unknown' ? 0.1 : 0.28 }}
            />
            <Icon className={`h-12 w-12 sm:h-14 sm:w-14 ${look.text}`} strokeWidth={1.5} />
          </div>
          <h1
            className={`mt-3 text-2xl font-semibold tracking-tight sm:text-3xl ${look.text}`}
          >
            {look.title}
          </h1>
          {look.sub && <p className="mt-1.5 text-sm text-slate-400">{look.sub}</p>}

          {status === 'protected' && (
            <p className="mt-4 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[#64748B]">
              {/* A live dot instead of the words "live" or "right now". */}
              <Pulse tone={CH.green} />
              {t ? (
                <span>
                  <AnimatedNumber value={t.queriesBlockedToday ?? null} format={(v) => num(v)} />{' '}
                  blocked today
                </span>
              ) : (
                <Skeleton className="h-3 w-28" />
              )}
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

      {/* The capability marquee was removed from Home on Dennis's "way too
          many words" note: it was a scrolling strip of seven phrases directly
          under the verdict, carrying no reading. It is still exported below
          and can go back on a marketing surface where words ARE the content -
          it just should not compete with the one screen someone opens to ask
          whether their family is safe. */}

      {/* ------------------------------------------------- why, if not fine */}
      {status === 'unprotected' && (
        <Warning
          tone="fault"
          title="Nothing is being filtered"
          detail={f?.lastError ?? 'The box is reachable but blocking nothing. Open Help.'}
        />
      )}
      {status === 'unknown' && (
        <Warning
          title="Not reachable from this phone"
          detail="Are you on home Wi-Fi rather than mobile data?"
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
              {/* The explanatory paragraph that used to sit here ("ads,
                  trackers and known-bad addresses your devices asked for and
                  did not get…") was four lines on a phone, under a number that
                  already says it. Three words plus the moving line carry the
                  same meaning. */}
              <p className="text-sm font-medium text-slate-200">Lookups refused</p>
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
            {/* Counting up is the ONE animation allowed to touch a figure, and
                only because AnimatedNumber short-circuits on null before its
                animation exists - a missing reading still lands as a dash and
                never counts up from zero to a number nobody measured. */}
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
          label="Blocked since you opened this"
          value={t ? num(t.queriesBlockedToday) : DASH}
          tone={CH.orange}
          right={<Delta samples={blocked.samples} />}
          // Still says it is not history - that claim has to stay - but in one
          // clause rather than two sentences.
          footer="Live only — the box keeps no history yet."
        >
          <AreaChart samples={blocked.samples} height={104} stroke={CH.orange} label="blocked today" />
        </ChartCard>
    </Screen>
  );
}
