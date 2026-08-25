/**
 * Gate^Flame — the phone app.
 *
 * Replaces MobileDashboard, which was AI-Studio-era: it drew a picture of a
 * phone inside the phone, carried four screens of invented data, and had drifted
 * so far from the console that the two disagreed about the same network.
 *
 * WHAT THIS IS
 *
 * A thin shell over the console's own data client. Discovery, pairing and the
 * token come from `services/`; every endpoint, response type, formatter and
 * honesty rule comes from `components/kiosk/kioskClient.ts`. Nothing about the
 * node is described twice, so the phone and the box cannot disagree.
 *
 * WHAT IT IS FOR, in the owner's words:
 *   1. show the customer what their box is doing, as graphs, legibly
 *   2. let them make the few adjustments that matter
 *   3. carry the assistant, because after install nobody sees the console again
 *
 * That third one is why Health exists and why warnings are loud. A fault that
 * only the console would have shown now has exactly one place left to appear.
 */

import { Suspense, lazy, useEffect, useState } from 'react';
import {
  Activity as ActivityIcon,
  Gamepad2,
  Home,
  ShieldAlert,
  SlidersHorizontal,
  Stethoscope,
  Wifi,
} from 'lucide-react';

import type { FilteringState } from '../types/filtering';
import { usePolled, type TelemetrySummary } from '../components/kiosk/kioskClient';
import { CH, LiveBackdrop } from '../components/kiosk/charts';
import { getToken, hasToken, onTokenRejected } from '../services/apiClient';
import { gateflameApi } from '../services/gateflameApi';
import { forgetNode } from '../services/nodeDiscovery';
import { AppPairingScreen } from '../components/AppPairingScreen';
import Ionibot, { defaultDeps } from '../ionibot';
import { buildIonibotContext, learnGateway } from '../services/ionibotContext';
import { startNodeSession } from './nodeSession';
import { HomeScreen } from './screens/HomeScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { ThreatsScreen } from './screens/ThreatsScreen';
import { NetworkScreen } from './screens/NetworkScreen';
import { HealthScreen } from './screens/HealthScreen';
import { ControlsScreen } from './screens/ControlsScreen';

/** Kept, at the owner's request. Lazy: it is the one screen most people never open. */
const IonicrobesGame = lazy(() =>
  import('../components/IonicrobesGame').then((m) => ({ default: m.IonicrobesGame })),
);

type TabId = 'home' | 'activity' | 'blocked' | 'network' | 'health' | 'settings' | 'game';

const TABS: { id: TabId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'activity', label: 'Activity', icon: ActivityIcon },
  { id: 'blocked', label: 'Blocked', icon: ShieldAlert },
  { id: 'network', label: 'Network', icon: Wifi },
  { id: 'health', label: 'Health', icon: Stethoscope },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  { id: 'game', label: 'Play', icon: Gamepad2 },
];

export function MobileApp() {
  const [paired, setPaired] = useState(() => hasToken());
  const [tab, setTab] = useState<TabId>('home');
  const [gateway, setGateway] = useState<string | null>(null);

  // Point the shared client at whatever node pairing currently holds, and keep
  // it there. Without this every request below would go to same-origin, which
  // on a Capacitor app is `https://localhost` and is nothing at all.
  useEffect(() => startNodeSession(), []);

  /*
   * Kick discovery. Nothing else does.
   *
   * The old shell got this for free from `useGateFlameEngine`, which also
   * carried a store, a mock adapter and a polling loop this app does not want.
   * Dropping it dropped the one line that mattered: without a connect() there
   * is no nodeBaseUrl, so the transport stays null, every request falls back to
   * same-origin, and the app sits there insisting it cannot see a box that is
   * two metres away. Found exactly that way on the first run.
   */
  useEffect(() => {
    if (!paired) return;
    void gateflameApi.connect();
  }, [paired]);

  // A revoked handset must notice. Before this existed, revocation worked on
  // the node and was invisible on the device: the dashboard stayed up and
  // retried a dead credential every few seconds, forever.
  useEffect(() => onTokenRejected(() => setPaired(false)), []);

  useEffect(() => {
    if (!paired) return;
    let live = true;
    void learnGateway().then((g) => {
      if (live && g) setGateway(g);
    });
    return () => {
      live = false;
    };
  }, [paired]);

  /*
   * Two polls, shared by every screen that needs them.
   *
   * Hoisted to the shell rather than run per screen so that switching tabs does
   * not restart the clock: `useSeries` builds its line from these, and a chart
   * that empties every time you look away is not a chart. The per-screen polls
   * (threats, clients, services) stay inside their screens and are gated on
   * `active`, because those are lists nobody needs collected in the background.
   */
  const telemetry = usePolled<TelemetrySummary>('/telemetry/summary', 4000, paired);
  const filtering = usePolled<FilteringState>('/filtering', 6000, paired);

  const ionibot = (
    <Ionibot
      ctx={buildIonibotContext(gateway)}
      contactUrl="mailto:info@ionity.today"
      probeDeps={{ ...defaultDeps, authToken: getToken }}
      startPairing={async () => {
        forgetNode();
        setPaired(false);
      }}
    />
  );

  /*
   * The backdrop's colour is the protection state and its liveliness is the
   * real block share. Both are readings, but neither is READABLE — you cannot
   * recover a number from a drifting mesh, which is exactly why it is allowed
   * to move on a screen whose entire job is telling the truth. Before pairing
   * there is no state to represent, so it sits neutral and calm.
   */
  const backdropTone =
    filtering.data?.protectionStatus === 'active'
      ? CH.blue
      : filtering.data?.protectionStatus === 'paused'
        ? CH.amber
        : filtering.data
          ? CH.red
          : CH.muted;

  if (!paired) {
    return (
      /* No tab bar on this screen, so the assistant bubble sits back down at
         the normal corner offset rather than floating above nothing. */
      <div
        className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#080D16]"
        style={{ ['--ib-fab-bottom' as string]: '16px' }}
      >
        <LiveBackdrop intensity={0.28} tone={CH.blue} className="opacity-50" />
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,111,211,0.16)_0%,transparent_55%)]" />
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <AppPairingScreen
            onPaired={() => {
              void gateflameApi.connect();
              setPaired(true);
            }}
          />
        </div>
        {/* Available DURING pairing, which is when people are most stuck. */}
        {ionibot}
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#080D16] text-slate-200">
      {/* An edge mesh, drifting — the product's own shape, used as atmosphere.
          Sits under a radial glow for depth; the design system asks for this
          rather than drop shadows, which turn to mud on an OLED panel. */}
      <LiveBackdrop
        intensity={Math.min(1, (telemetry.data?.blockPercentage ?? 10) / 40)}
        tone={backdropTone}
        className="opacity-[0.55]"
      />
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(0,111,211,0.14)_0%,transparent_55%)]" />

      {tab === 'home' && <HomeScreen telemetry={telemetry} filtering={filtering} />}
      {tab === 'activity' && <ActivityScreen telemetry={telemetry} />}
      {tab === 'blocked' && <ThreatsScreen active={tab === 'blocked'} />}
      {tab === 'network' && <NetworkScreen active={tab === 'network'} />}
      {tab === 'health' && (
        <HealthScreen telemetry={telemetry} filtering={filtering} active={tab === 'health'} />
      )}
      {tab === 'settings' && <ControlsScreen filtering={filtering} />}
      {tab === 'game' && (
        <div
          className="relative z-10 flex-1 overflow-y-auto px-4 pt-3 no-scrollbar"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 7rem)' }}
        >
          <div className="mx-auto w-full max-w-md sm:max-w-xl">
            <Suspense fallback={<p className="p-6 text-center text-sm text-[#64748B]">Loading…</p>}>
              <IonicrobesGame />
            </Suspense>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------- tab bar
          Seven destinations is more than a phone bar comfortably holds, so
          this is a 7-column GRID rather than a scrolling row. A scroller hides
          destinations off-screen and, worse, leaves the bar in a half-scrolled
          position that reads as broken; a grid always shows all seven and lets
          each cell shrink instead. The cells stay above the 48px touch-target
          floor down to a 320dp screen, which is narrower than anything still
          being sold. The bar itself is centred and capped so it becomes a
          floating pill on a tablet rather than a stretched ribbon.        */}
      <nav
        className="absolute inset-x-0 z-40 px-3"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 0.75rem)' }}
      >
        <div className="mx-auto grid w-full max-w-md grid-cols-7 items-center gap-0.5 rounded-2xl border border-[#1E293B] bg-[#111A28]/95 px-1.5 py-1.5 backdrop-blur-xl sm:max-w-lg sm:gap-1 sm:px-2 sm:py-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={on ? 'page' : undefined}
                aria-label={t.label}
                className={`relative flex min-h-[48px] flex-col items-center justify-center rounded-xl transition-colors ${
                  on ? 'bg-[#38BDF8]/10' : ''
                }`}
              >
                {/* The active marker is a bar above the icon rather than a
                    filled cell: at this width a filled cell swallows the
                    label, and the label is what makes the bar learnable. */}
                <span
                  className={`absolute inset-x-3 top-0 h-0.5 rounded-full transition-all duration-300 ${
                    on ? 'bg-[#38BDF8] opacity-100 shadow-[0_0_10px_rgba(56,189,248,0.8)]' : 'opacity-0'
                  }`}
                />
                <Icon
                  className={`h-[18px] w-[18px] transition-colors sm:h-5 sm:w-5 ${
                    on ? 'text-[#38BDF8]' : 'text-[#64748B]'
                  }`}
                />
                <span
                  className={`mt-0.5 max-w-full truncate px-0.5 font-mono text-[7px] font-bold uppercase tracking-wide transition-colors sm:text-[9px] sm:tracking-wider ${
                    on ? 'text-[#38BDF8]' : 'text-[#64748B]'
                  }`}
                >
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* The assistant rides above every screen as a bubble, never a
          destination - being stuck is not a place you navigate to. */}
      {ionibot}
    </div>
  );
}

export default MobileApp;
