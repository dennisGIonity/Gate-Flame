/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: shell
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The appliance's own face.
 *
 * Shape: a lock screen, then a tabbed console — one tab per capability the node
 * actually has, each carrying its own telemetry, its own charts and its own
 * controls. That sits deliberately between the two things this project has
 * already tried:
 *
 *   - DeviceOnboardingSimulator (deleted): rich, animated, tabbed — and almost
 *     entirely fictional. It offered a Wi-Fi picker for an endpoint that has
 *     never existed.
 *   - GateFlameKiosk (superseded by this): one honest page, four regions, no
 *     controls at all. Nothing false, but the owner could not change anything
 *     and the screen showed a fraction of what the agent knows.
 *
 * This keeps the second one's rule — never display a value the API did not
 * return — and gives back the first one's reach, with every panel wired to a
 * route in node-agent/gateflame/main.py and nothing wired to Math.random().
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bug,
  Gauge as GaugeIcon,
  LayoutDashboard,
  Lock,
  type LucideIcon,
  Network,
  ShieldHalf,
  Signal,
  Smartphone,
  Boxes,
} from 'lucide-react';

import type { FilteringState, PauseDurationId, ThreatLevelId } from '../../types/filtering';
import {
  DASH,
  consoleAuthority,
  kioskApi,
  usePolled,
  type KioskMount,
  type PairResponse,
  type SystemStatus,
  type TelemetrySummary,
} from './kioskClient';
import { ActionButton, Card, HoldButton, NotTheConsole } from './kioskUi';
import { CH, LiveBackdrop } from './charts';
import ConsoleLock from './ConsoleLock';
import { FilteringPanel, NetworkPanel, OverviewPanel, ThreatsPanel, type PanelContext } from './panels';
import { FirewallPanel, ModulesPanel, SystemPanel, WanPanel } from './panelsSystem';
import { ShieldPanel, SHIELD_TAB_ICON } from './panelsShield';

type TabId = 'overview' | 'filtering' | 'threats' | 'shield' | 'network' | 'modules' | 'firewall' | 'wan' | 'system';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'filtering', label: 'Filtering', icon: ShieldHalf },
  { id: 'threats', label: 'Threats', icon: Bug },
  { id: 'shield', label: 'Shield', icon: SHIELD_TAB_ICON },
  { id: 'network', label: 'Network', icon: Network },
  { id: 'modules', label: 'Modules', icon: Boxes },
  { id: 'firewall', label: 'Firewall', icon: Activity },
  { id: 'wan', label: 'WAN', icon: Signal },
  { id: 'system', label: 'System', icon: GaugeIcon },
];

/** A wall panel left open in a hallway locks itself again. */
const IDLE_LOCK_MS = 4 * 60 * 1000;

export default function KioskApp() {
  const authority = useMemo(() => consoleAuthority(), []);
  const [unlocked, setUnlocked] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');

  const status = usePolled<SystemStatus>('/system/status', 10000);
  const telemetry = usePolled<TelemetrySummary>('/telemetry/summary', 4000);
  const filteringPoll = usePolled<FilteringState>('/filtering', 5000);
  // LAN-gated like /system/status, so it answers even when every scoped read is
  // refused. That makes it the one thing worth showing on the refusal screen.
  const kioskMount = usePolled<KioskMount>('/system/kiosk', 60000);

  // Writes return the new state, so the control surface updates from the
  // node's answer rather than from an optimistic guess about what it did.
  const [filteringOverride, setFilteringOverride] = useState<FilteringState | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const filtering = filteringOverride ?? filteringPoll.data;

  // The poll is the source of truth; an override only survives until the next
  // successful read, so a change made elsewhere (the phone) still wins.
  useEffect(() => {
    if (filteringPoll.data) setFilteringOverride(null);
  }, [filteringPoll.data]);

  const reachable = !(
    (status.error?.unreachable ?? false) &&
    (telemetry.error?.unreachable ?? false)
  );

  /**
   * The node answered and said no.
   *
   * Distinct from unreachable in every way that matters: the box is fine, it is
   * running, it is filtering — it simply will not talk to this page. Keyed off
   * /telemetry/summary because that is the first scoped read the console makes,
   * and off /status having succeeded, which proves the agent is alive.
   */
  const refused = telemetry.error?.status === 401 && status.data !== null;

  // ---- idle re-lock ------------------------------------------------------
  const lastTouch = useRef(Date.now());
  useEffect(() => {
    if (!unlocked) return;
    const touch = () => {
      lastTouch.current = Date.now();
    };
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const id = setInterval(() => {
      if (Date.now() - lastTouch.current > IDLE_LOCK_MS) setUnlocked(false);
    }, 15000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(id);
    };
  }, [unlocked]);

  // ---- pairing -----------------------------------------------------------
  const [pairing, setPairing] = useState<PairResponse | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);

  const startPairing = useCallback(async () => {
    setPairError(null);
    try {
      setPairing(await kioskApi.requestPairingCode());
    } catch (err) {
      // No fabricated code, ever. A pairing screen that invents six digits
      // sends the owner to type them into a phone that will reject them.
      setPairError(err instanceof Error ? err.message : 'The node would not issue a code.');
    }
  }, []);

  // ---- filtering mutations ----------------------------------------------
  const runMutation = useCallback(async (fn: () => Promise<FilteringState>) => {
    setMutating(true);
    setMutationError(null);
    try {
      setFilteringOverride(await fn());
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'The node refused that change.');
    } finally {
      setMutating(false);
    }
  }, []);

  const panelCtx = (id: TabId): PanelContext => ({
    telemetry: telemetry.data,
    filtering,
    authority,
    active: tab === id,
  });

  if (!unlocked) {
    return (
      <ConsoleLock
        nodeId={status.data?.nodeId ?? null}
        agentVersion={status.data?.agentVersion ?? null}
        protection={filtering?.protectionStatus ?? null}
        protectionDetail={
          filtering?.protectionStatus === 'paused'
            ? `${filtering.durationLabel ?? 'Paused'}${filtering.reason ? ` — “${filtering.reason}”` : ''}`
            : filtering?.protectionStatus === 'bypass'
              ? 'The DNS watchdog fell back to an unfiltered resolver. This is a fault.'
              : (telemetry.data?.gap ?? null)
        }
        reachable={reachable}
        refused={refused}
        authority={authority}
        verifyPin={kioskMount.data?.consolePinEnabled ? kioskApi.verifyConsolePin : null}
        onUnlock={() => {
          lastTouch.current = Date.now();
          setUnlocked(true);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#080D16] font-sans text-slate-200 antialiased">
      {/* An edge mesh, drifting. Its liveliness is scaled by the real block
          share and its COLOUR is the real protection state — so a paused or
          failed box does not sit behind a confident blue field. It encodes no
          value anyone could read off it: this is atmosphere, not a chart, and
          the distinction is the reason it is allowed to move at all. */}
      <LiveBackdrop
        intensity={Math.min(1, (telemetry.data?.blockPercentage ?? 12) / 45)}
        tone={
          filtering?.protectionStatus === 'active'
            ? CH.blue
            : filtering?.protectionStatus === 'paused'
              ? CH.amber
              : filtering
                ? CH.red
                : CH.muted
        }
        className="opacity-[0.45]"
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(0,111,211,0.08)_0%,transparent_70%)]" />

      {/* ---- Header --------------------------------------------------- */}
      <header className="relative z-10 flex shrink-0 items-center justify-between border-b border-[#1E293B] bg-[#111A28]/80 px-8 py-4 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#1E293B] bg-[#0F1B2D]">
            <svg className="h-6 w-6 text-[#006FD3]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-wide">
              GATE<span className="text-[#006FD3]">^</span>FLAME
            </h1>
            <p className="mt-0.5 font-mono text-xs uppercase tracking-[0.2em] text-[#475569]">
              {status.data?.nodeId ?? DASH} · v{status.data?.agentVersion ?? DASH}
              {status.data?.provisioned === false && ' · not yet provisioned'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {authority === 'viewer' && (
            <span className="rounded-full border border-[#1E293B] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Read-only view
            </span>
          )}
          <ActionButton onClick={() => void startPairing()} disabled={authority !== 'console'}>
            <span className="flex items-center gap-2">
              <Smartphone className="h-4 w-4" /> Pair a phone
            </span>
          </ActionButton>
          <ActionButton tone="ghost" onClick={() => setUnlocked(false)}>
            <span className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Lock
            </span>
          </ActionButton>
        </div>
      </header>

      {/* ---- Unreachable ----------------------------------------------
          Covers the console rather than dimming it. Numbers underneath are
          from the last successful poll and saying nothing about now.        */}
      {!reachable && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#080D16]/92 backdrop-blur-sm">
          <Card accent="fault" className="max-w-lg text-center">
            <h2 className="text-3xl font-semibold text-slate-100">Node unreachable</h2>
            <p className="mt-3 text-slate-400">
              This display has lost contact with the agent. Nothing behind this panel describes the network as it
              is now.
            </p>
            <p className="mt-4 font-mono text-sm text-slate-500">
              Last answer:{' '}
              {telemetry.lastSeen
                ? telemetry.lastSeen.toLocaleTimeString('en-ZA', { hour12: false })
                : 'never since this screen opened'}
            </p>
          </Card>
        </div>
      )}

      {/* ---- Tab rail --------------------------------------------------- */}
      <nav
        className={`relative z-10 shrink-0 gap-2 border-b border-[#1E293B] bg-[#0B121E]/60 px-8 py-3 ${
          refused ? 'hidden' : 'flex'
        }`}
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const activeTab = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              // 44px+ target, icon and word together: read from two metres,
              // pressed by a fingertip.
              className={`flex min-h-11 items-center gap-2.5 rounded-xl border px-5 py-2.5 text-sm font-semibold uppercase tracking-wider transition-all ${
                activeTab
                  ? 'border-2 border-[#38BDF8] bg-[#38BDF8]/10 text-[#38BDF8] shadow-[0_0_24px_rgba(56,189,248,0.25)]'
                  : 'border-[#1E293B] bg-[#0F1B2D]/50 text-slate-400 hover:border-[#334155] hover:text-slate-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* ---- Panel ------------------------------------------------------ */}
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto p-8">
        {refused && <NotTheConsole nodeId={status.data?.nodeId ?? null} kioskPath={kioskMount.data?.path ?? null} />}
        {!refused && tab === 'overview' && <OverviewPanel {...panelCtx('overview')} />}
        {!refused && tab === 'filtering' && (
          <FilteringPanel
            {...panelCtx('filtering')}
            busy={mutating}
            error={mutationError}
            onSetLevel={(l: ThreatLevelId) => void runMutation(() => kioskApi.setThreatLevel(l))}
            onSetCategories={(ids: string[]) => void runMutation(() => kioskApi.setCategories(ids))}
            onPause={(d: PauseDurationId, reason?: string) => void runMutation(() => kioskApi.pauseFiltering(d, reason))}
            onResume={() => void runMutation(() => kioskApi.resumeFiltering())}
          />
        )}
        {!refused && tab === 'threats' && <ThreatsPanel {...panelCtx('threats')} />}
        {!refused && tab === 'shield' && <ShieldPanel {...panelCtx('shield')} />}
        {!refused && tab === 'network' && <NetworkPanel {...panelCtx('network')} />}
        {!refused && tab === 'modules' && <ModulesPanel {...panelCtx('modules')} />}
        {!refused && tab === 'firewall' && <FirewallPanel {...panelCtx('firewall')} />}
        {!refused && tab === 'wan' && <WanPanel {...panelCtx('wan')} />}
        {!refused && tab === 'system' && <SystemPanel {...panelCtx('system')} status={status.data} />}
      </main>

      {/* ---- Footer ----------------------------------------------------- */}
      <footer className="relative z-10 flex shrink-0 items-center justify-between border-t border-[#1E293B] bg-[#0B121E]/60 px-8 py-2.5 text-[11px] uppercase tracking-[0.25em] text-[#475569]">
        <span>Ionity Gate^Flame Node</span>
        <span className="font-mono normal-case tracking-normal">
          {status.data?.nodeId ?? DASH} · agent v{status.data?.agentVersion ?? DASH} ·{' '}
          {telemetry.lastSeen ? `updated ${telemetry.lastSeen.toLocaleTimeString('en-ZA', { hour12: false })}` : 'no data yet'}
        </span>
        <span>Building Tomorrow, Today.</span>
      </footer>

      {/* ---- Pairing overlay -------------------------------------------- */}
      {(pairing || pairError) && (
        <PairingOverlay
          pairing={pairing}
          error={pairError}
          onClose={() => {
            setPairing(null);
            setPairError(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * The single most important interaction on this screen: it is how a customer
 * gets the phone app working without a terminal. The code is rendered huge, the
 * countdown is real (driven off `expiresAt`, not off a guess), and when it runs
 * out the overlay says so instead of leaving a dead code on the glass.
 */
function PairingOverlay({
  pairing,
  error,
  onClose,
}: {
  pairing: PairResponse | null;
  error: string | null;
  onClose: () => void;
}) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!pairing) return;
    const tick = () => {
      const ms = new Date(pairing.expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairing]);

  const expired = remaining !== null && remaining <= 0;

  return (
    <div className="absolute inset-0 z-[60] flex items-center justify-center bg-[#080D16]/95 backdrop-blur-md">
      <Card className="w-[46rem] text-center" accent={error ? 'fault' : 'none'}>
        {error ? (
          <>
            <h2 className="text-3xl font-semibold text-[#E11D48]">Could not issue a code</h2>
            <p className="mt-3 text-slate-400">{error}</p>
          </>
        ) : (
          <>
            <p className="text-sm uppercase tracking-[0.3em] text-slate-500">Enter this code in the Gate^Flame app</p>
            <p
              className={`mt-6 font-mono text-8xl tabular-nums tracking-[0.15em] ${
                expired ? 'text-slate-700 line-through' : 'text-[#38BDF8]'
              }`}
            >
              {pairing?.code ?? DASH}
            </p>
            <p className="mt-6 text-lg text-slate-300">
              {expired ? (
                'This code has expired. Close and request a new one.'
              ) : (
                <>
                  Expires in{' '}
                  <span className="font-mono tabular-nums text-slate-100">
                    {remaining === null ? DASH : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`}
                  </span>
                </>
              )}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {pairing?.attemptsRemaining ?? DASH} attempts remaining · the phone must be on this network
            </p>
          </>
        )}
        <div className="mt-8 flex justify-center">
          <HoldButton label="Hold to close" tone="primary" ms={600} onConfirm={onClose} />
        </div>
      </Card>
    </div>
  );
}
