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

  if (!paired) {
    return (
      <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#080D16]">
        <AppPairingScreen
          onPaired={() => {
            void gateflameApi.connect();
            setPaired(true);
          }}
        />
        {/* Available DURING pairing, which is when people are most stuck. */}
        {ionibot}
      </div>
    );
  }

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#080D16] text-slate-200">
      {/* One radial glow for depth. The design system asks for this rather than
          drop shadows, which turn to mud on an OLED panel. */}
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
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-36 pt-3">
          <Suspense
            fallback={<p className="p-6 text-center text-sm text-[#64748B]">Loading…</p>}
          >
            <IonicrobesGame />
          </Suspense>
        </div>
      )}

      {/* --------------------------------------------------------- tab bar */}
      <nav className="absolute inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] z-40 flex snap-x items-center gap-1 overflow-x-auto rounded-2xl border border-[#1E293B] bg-[#111A28]/95 px-2 py-2 no-scrollbar backdrop-blur-xl">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              aria-current={on ? 'page' : undefined}
              /* 48px minimum, per the design system's touch-target rule. */
              className="flex min-h-[48px] min-w-[52px] shrink-0 snap-center flex-col items-center justify-center rounded-xl px-1"
            >
              <Icon className={`h-5 w-5 ${on ? 'text-[#38BDF8]' : 'text-[#64748B]'}`} />
              <span
                className={`mt-0.5 font-mono text-[8px] font-bold uppercase tracking-wider ${
                  on ? 'text-[#38BDF8]' : 'text-[#64748B]'
                }`}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* The assistant rides above every screen as a bubble, never a
          destination - being stuck is not a place you navigate to. */}
      {ionibot}
    </div>
  );
}

export default MobileApp;
