/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: first-time setup
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The screen on the box is SETUP (docs/LAUNCH-SCOPE-T3-T1-2026-10-03.md).
 *
 *   1. Connect  - put the box on the household network: a cable, or a Wi-Fi list and a
 *                 password typed on the glass (there is no keyboard on the appliance).
 *   2. Router   - the one step ADR-001 asks of the customer, with a LIVE read-back.
 *   3. Pair     - a code for the phone. The app is where the customer lives from here on.
 *
 * Rules this screen keeps, each of them a mistake already made once elsewhere:
 *   - The node's sentences (`gap`, `detail`) are rendered verbatim. This file writes no
 *     claim about what the filter blocks and none about why a join failed.
 *   - "Could not check" and "checked, it is not" never share a sentence. `forwardsToUs`
 *     null is the first; only an explicit false is the second.
 *   - A Wi-Fi password lives in this component's state until it is sent, is never put in
 *     a URL, a log or the DOM as text unless the owner taps "Show", and is cleared the
 *     moment the node answers - success or failure.
 *   - No fabricated pairing code: if the node would not issue one, the screen says so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cable, Check, Delete, Eye, EyeOff, Loader2, Lock, RefreshCw, Smartphone, Wifi } from 'lucide-react';

import type { RouterCheckResponse } from '../../types/routerCheck';
import type { NetworkStatus, WifiNetwork, WifiScan } from '../../types/networkSetup';
import {
  DASH,
  NodeError,
  kioskApi,
  usePolled,
  type PairResponse,
  type PairedDevice,
} from './kioskClient';
import { ActionButton, Card, HoldButton } from './kioskUi';

type Step = 'connect' | 'router' | 'pair';

const STEPS: { id: Step; label: string }[] = [
  { id: 'connect', label: 'Connect' },
  { id: 'router', label: 'Router' },
  { id: 'pair', label: 'Pair' },
];

// ---------------------------------------------------------------------------
// On-screen keyboard. The appliance has a touch panel and nothing else.
// ---------------------------------------------------------------------------

const ROWS = {
  lower: ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  upper: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'],
  symbols: ['!@#$%^&*()', '-_=+[]{}\\|', ";:'\",.<>/?", '`~ '],
} as const;

export function OnScreenKeyboard({
  onKey,
  onBackspace,
  onEnter,
  enterLabel = 'Join',
}: {
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onEnter: () => void;
  enterLabel?: string;
}) {
  const [layer, setLayer] = useState<keyof typeof ROWS>('lower');
  const key =
    'min-h-12 min-w-11 flex-1 rounded-lg border border-[#1E293B] bg-[#0F1B2D] px-2 py-2 font-mono text-lg text-slate-100 active:bg-[#1E293B]';
  return (
    <div className="space-y-2" data-testid="osk">
      {ROWS[layer].map((row) => (
        <div key={row} className="flex gap-1.5">
          {[...row].map((ch) => (
            <button key={ch} type="button" className={key} onClick={() => onKey(ch)}>
              {ch}
            </button>
          ))}
        </div>
      ))}
      <div className="flex gap-1.5">
        <button
          type="button"
          className={`${key} text-sm uppercase`}
          onClick={() => setLayer(layer === 'lower' ? 'upper' : 'lower')}
        >
          {layer === 'upper' ? 'abc' : 'ABC'}
        </button>
        <button
          type="button"
          className={`${key} text-sm uppercase`}
          onClick={() => setLayer(layer === 'symbols' ? 'lower' : 'symbols')}
        >
          {layer === 'symbols' ? 'abc' : '#+='}
        </button>
        <button type="button" className={`${key} flex-[3]`} onClick={() => onKey(' ')} aria-label="space">
          space
        </button>
        <button type="button" className={key} onClick={onBackspace} aria-label="backspace">
          <Delete className="mx-auto h-5 w-5" />
        </button>
        <button
          type="button"
          className="min-h-12 flex-[2] rounded-lg bg-[#006FD3] px-3 py-2 text-sm font-semibold uppercase tracking-wider text-white"
          onClick={onEnter}
        >
          {enterLabel}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

export default function SetupFlow({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState<Step>('connect');
  const network = usePolled<NetworkStatus>('/network/status', 4000);
  // Paired devices are what ends setup: the first one to appear is the proof.
  const devices = usePolled<{ devices: PairedDevice[] }>('/pair/devices', 3000, step === 'pair');
  const paired = devices.data?.devices?.[0] ?? null;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#080D16] font-sans text-slate-200 antialiased">
      <header className="flex shrink-0 items-center justify-between border-b border-[#1E293B] bg-[#111A28]/80 px-8 py-4">
        <h1 className="text-xl font-semibold tracking-wide">
          GATE<span className="text-[#006FD3]">^</span>FLAME <span className="ml-3 text-sm uppercase tracking-[0.25em] text-slate-500">Setup</span>
        </h1>
        <ol className="flex items-center gap-3" aria-label="Setup steps">
          {STEPS.map((s, i) => {
            const here = s.id === step;
            const past = STEPS.findIndex((x) => x.id === step) > i;
            return (
              <li
                key={s.id}
                aria-current={here ? 'step' : undefined}
                className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-xs font-semibold uppercase tracking-wider ${
                  here
                    ? 'border-[#38BDF8] bg-[#38BDF8]/10 text-[#38BDF8]'
                    : past
                      ? 'border-[#10B981]/50 text-[#10B981]'
                      : 'border-[#1E293B] text-slate-500'
                }`}
              >
                {past ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>}
                {s.label}
              </li>
            );
          })}
        </ol>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-8">
        {step === 'connect' && <ConnectStep network={network.data} error={network.error} onNext={() => setStep('router')} />}
        {step === 'router' && (
          <RouterStep boxAddress={network.data?.boxAddress ?? null} onBack={() => setStep('connect')} onNext={() => setStep('pair')} />
        )}
        {step === 'pair' && (
          <PairStep paired={paired} onBack={() => setStep('router')} onFinish={onFinish} />
        )}
      </main>

      <footer className="flex shrink-0 items-center justify-between border-t border-[#1E293B] bg-[#0B121E]/60 px-8 py-2.5 text-[11px] uppercase tracking-[0.25em] text-[#475569]">
        <span>Ionity Gate^Flame Node</span>
        {/* An installer or support engineer can still reach the console. A hold, so a
            customer's sleeve cannot skip setup. */}
        <HoldButton label="Hold to open the full console" tone="primary" ms={1500} onConfirm={onFinish} className="!py-1.5 !text-[11px]" />
        <span>Building Tomorrow, Today.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Connect
// ---------------------------------------------------------------------------

function signalBars(signal: number): string {
  return signal >= 75 ? '▂▄▆█' : signal >= 50 ? '▂▄▆' : signal >= 25 ? '▂▄' : '▂';
}

function ConnectStep({
  network,
  error,
  onNext,
}: {
  network: NetworkStatus | null;
  error: NodeError | null;
  onNext: () => void;
}) {
  const [scan, setScan] = useState<WifiScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [picked, setPicked] = useState<WifiNetwork | null>(null);
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);

  const doScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      setScan(await kioskApi.wifiScan());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'The node could not scan.');
    } finally {
      setScanning(false);
    }
  }, []);

  const doJoin = useCallback(async () => {
    if (!picked || joining) return;
    setJoining(true);
    setJoinError(null);
    const sent = password;
    try {
      const res = await kioskApi.wifiConnect(picked.ssid, picked.security === 'open' ? null : sent);
      setJoined(res.address ?? null);
      setPicked(null);
    } catch (err) {
      // The node's own sentence (409 `detail`), never composed here.
      setJoinError(err instanceof Error ? err.message : 'The node could not join that network.');
    } finally {
      // Success or failure, the password has done its job.
      setPassword('');
      setReveal(false);
      setJoining(false);
    }
  }, [picked, password, joining]);

  const hasAddress = Boolean(network?.boxAddress);

  return (
    <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
      <Card title="This box's network" accent={hasAddress ? 'good' : 'none'}>
        {error && !network && (
          <p className="text-slate-400">
            {error.unreachable ? 'The box agent is not answering yet.' : error.message}
          </p>
        )}
        {network && (
          <dl className="space-y-3 text-lg">
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-slate-400"><Cable className="h-5 w-5" /> Cable</dt>
              <dd className="font-mono text-slate-100">
                {network.wired.address ?? (network.wired.present ? (network.wired.up ? 'no address yet' : 'not plugged in') : 'none on this box')}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="flex items-center gap-2 text-slate-400"><Wifi className="h-5 w-5" /> Wi-Fi</dt>
              <dd className="font-mono text-slate-100">
                {network.wifi.connected
                  ? `${network.wifi.ssid ?? 'connected'}${network.wifi.address ? ` · ${network.wifi.address}` : ''}`
                  : network.wifi.present ? 'not connected' : 'no adapter'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-[#1E293B] pt-3">
              <dt className="text-slate-400">Box address</dt>
              <dd className="font-mono text-2xl text-[#38BDF8]">{network.boxAddress ?? DASH}</dd>
            </div>
            <div className="flex items-center justify-between gap-4">
              <dt className="text-slate-400">Internet</dt>
              <dd className="font-mono text-slate-100">
                {network.internet === true ? 'reachable' : network.internet === false ? 'not reachable' : DASH}
              </dd>
            </div>
          </dl>
        )}
        {network?.gap && <p className="mt-4 text-sm text-slate-500">{network.gap}</p>}
        {joined !== null && <p className="mt-4 text-[#10B981]">Joined{joined ? ` · ${joined}` : ''}.</p>}
        <div className="mt-6">
          <ActionButton onClick={onNext} disabled={!hasAddress}>Continue</ActionButton>
          {!hasAddress && (
            <p className="mt-3 text-sm text-slate-500">
              Plug in a network cable, or choose a Wi-Fi network. Continue unlocks once the box has an address.
            </p>
          )}
        </div>
      </Card>

      <Card
        title="Wi-Fi"
        subtitle={picked ? undefined : 'Pick your home network, or just use a cable.'}
        right={
          !picked && (
            <ActionButton tone="ghost" onClick={() => void doScan()} disabled={scanning}>
              <span className="flex items-center gap-2">
                {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {scan ? 'Scan again' : 'Scan'}
              </span>
            </ActionButton>
          )
        }
      >
        {!picked && (
          <>
            {scanError && <p className="text-[#E11D48]">{scanError}</p>}
            {scan?.gap && <p className="mb-3 text-sm text-slate-400">{scan.gap}</p>}
            {scan && scan.networks.length === 0 && !scan.gap && <p className="text-slate-400">No networks in range.</p>}
            {!scan && !scanning && !scanError && <p className="text-slate-500">Press Scan to list the networks in range.</p>}
            <ul className="max-h-[22rem] space-y-2 overflow-y-auto">
              {scan?.networks.map((n) => (
                <li key={n.ssid}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked(n);
                      setJoinError(null);
                      setJoined(null);
                    }}
                    className="flex min-h-12 w-full items-center justify-between rounded-xl border border-[#1E293B] bg-[#0F1B2D] px-4 py-3 text-left text-lg hover:border-[#334155]"
                  >
                    <span className="truncate">{n.ssid}</span>
                    <span className="ml-4 flex shrink-0 items-center gap-3 font-mono text-sm text-slate-400">
                      {n.security !== 'open' && <Lock className="h-4 w-4" aria-label="secured" />}
                      <span aria-label={`signal ${n.signal} percent`}>{signalBars(n.signal)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {picked && (
          <div className="space-y-4">
            <p className="text-lg">
              Join <span className="font-semibold text-[#38BDF8]">{picked.ssid}</span>
            </p>
            {picked.security !== 'open' ? (
              <div className="flex items-center gap-2">
                <div
                  className="min-h-12 flex-1 rounded-lg border border-[#334155] bg-[#080D16] px-4 py-3 font-mono text-lg"
                  aria-label="Wi-Fi password"
                  data-testid="password-field"
                >
                  {reveal ? password : '•'.repeat(password.length)}
                  <span className="animate-pulse text-[#38BDF8]">|</span>
                </div>
                <button
                  type="button"
                  className="min-h-12 rounded-lg border border-[#1E293B] bg-[#0F1B2D] px-3"
                  onClick={() => setReveal((r) => !r)}
                  aria-label={reveal ? 'Hide password' : 'Show password'}
                >
                  {reveal ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            ) : (
              <p className="text-slate-400">This network has no password.</p>
            )}
            {joinError && <p className="rounded-lg border border-[#E11D48]/40 bg-[#E11D48]/10 px-4 py-3 text-[#FDA4AF]">{joinError}</p>}
            {picked.security !== 'open' && (
              <OnScreenKeyboard
                onKey={(ch) => setPassword((p) => (p.length < 64 ? p + ch : p))}
                onBackspace={() => setPassword((p) => p.slice(0, -1))}
                onEnter={() => void doJoin()}
                enterLabel={joining ? 'Joining…' : 'Join'}
              />
            )}
            <div className="flex gap-3">
              {picked.security === 'open' && (
                <ActionButton onClick={() => void doJoin()} disabled={joining}>
                  {joining ? 'Joining…' : 'Join'}
                </ActionButton>
              )}
              <ActionButton
                tone="ghost"
                onClick={() => {
                  setPicked(null);
                  setPassword('');
                  setReveal(false);
                  setJoinError(null);
                }}
                disabled={joining}
              >
                Back
              </ActionButton>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Router
// ---------------------------------------------------------------------------

export function RouterStep({
  boxAddress,
  onBack,
  onNext,
}: {
  boxAddress: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const check = usePolled<RouterCheckResponse>('/network/router-check', 4000);
  const data = check.data;
  const address = data?.boxAddress ?? boxAddress;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card title="One step at your router" accent={data?.forwardsToUs === true ? 'good' : 'none'}>
        <p className="text-lg leading-relaxed text-slate-300">
          Open your router's settings and set its <span className="font-semibold text-slate-100">DNS server</span> to
          this box's address:
        </p>
        <p className="my-6 text-center font-mono text-6xl tracking-wider text-[#38BDF8]" data-testid="box-address">
          {address ?? DASH}
        </p>
        <p className="text-sm text-slate-500">
          Leave everything else on the router as it is. This screen checks the router for you; you do not need to
          restart anything here.
        </p>
      </Card>

      <Card title="Is your router doing it?">
        {/* Three states, three different sentences. null is never "not". */}
        {!data && !check.error && (
          <p className="flex items-center gap-3 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Checking…</p>
        )}
        {!data && check.error && (
          <p className="text-slate-400">Could not ask the box: {check.error.message}</p>
        )}
        {data?.forwardsToUs === true && (
          <p className="flex items-center gap-3 text-xl text-[#10B981]">
            <Check className="h-6 w-6" /> Yes — your router is sending its lookups to this box.
          </p>
        )}
        {data?.forwardsToUs === false && (
          <div>
            <p className="text-xl text-[#F59E0B]">Not yet — your router is not sending its lookups to this box.</p>
            <p className="mt-2 text-slate-400">
              Set the DNS server on your router to {address ?? DASH}, save, and this check will turn green by itself.
            </p>
          </div>
        )}
        {data && data.forwardsToUs === null && (
          <div>
            <p className="text-xl text-slate-200">Could not check yet.</p>
            {data.gap && <p className="mt-2 text-slate-400">{data.gap}</p>}
          </div>
        )}
      </Card>

      <div className="flex gap-3">
        <ActionButton tone="ghost" onClick={onBack}>Back</ActionButton>
        <ActionButton onClick={onNext}>
          {data?.forwardsToUs === true ? 'Continue' : 'Continue anyway'}
        </ActionButton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Pair
// ---------------------------------------------------------------------------

function PairStep({
  paired,
  onBack,
  onFinish,
}: {
  paired: PairedDevice | null;
  onBack: () => void;
  onFinish: () => void;
}) {
  const [pairing, setPairing] = useState<PairResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const requested = useRef(false);

  const request = useCallback(async () => {
    setError(null);
    try {
      setPairing(await kioskApi.requestPairingCode());
    } catch (err) {
      // No fabricated code, ever.
      setPairing(null);
      setError(err instanceof Error ? err.message : 'The node would not issue a code.');
    }
  }, []);

  useEffect(() => {
    if (requested.current || paired) return;
    requested.current = true;
    void request();
  }, [request, paired]);

  useEffect(() => {
    if (!pairing) return;
    const tick = () => setRemaining(Math.max(0, Math.floor((new Date(pairing.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pairing]);

  const expired = remaining !== null && remaining <= 0;
  const mm = useMemo(
    () => (remaining === null ? DASH : `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`),
    [remaining],
  );

  if (paired) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card accent="good" className="text-center">
          <Check className="mx-auto h-14 w-14 text-[#10B981]" />
          <h2 className="mt-4 text-3xl font-semibold text-slate-100">Phone paired</h2>
          <p className="mt-3 text-lg text-slate-300">
            {paired.deviceName ? <span className="font-semibold text-[#38BDF8]">{paired.deviceName}</span> : 'A phone'} is
            now connected to this box.
          </p>
          <p className="mt-2 text-slate-400">From here on, look at your numbers and change your settings in the Gate^Flame app.</p>
          <div className="mt-8 flex justify-center">
            <ActionButton onClick={onFinish}>Done</ActionButton>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card accent={error ? 'fault' : 'none'} className="text-center">
        <p className="flex items-center justify-center gap-2 text-sm uppercase tracking-[0.3em] text-slate-500">
          <Smartphone className="h-4 w-4" /> Enter this code in the Gate^Flame app
        </p>
        {error ? (
          <>
            <h2 className="mt-4 text-3xl font-semibold text-[#E11D48]">Could not issue a code</h2>
            <p className="mt-3 text-slate-400">{error}</p>
          </>
        ) : (
          <>
            <p
              data-testid="pairing-code"
              className={`mt-6 font-mono text-8xl tabular-nums tracking-[0.15em] ${expired ? 'text-slate-700 line-through' : 'text-[#38BDF8]'}`}
            >
              {pairing?.code ?? DASH}
            </p>
            <p className="mt-6 text-lg text-slate-300">
              {expired ? 'This code has expired.' : <>Expires in <span className="font-mono tabular-nums text-slate-100">{mm}</span></>}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {pairing?.attemptsRemaining ?? DASH} attempts remaining · the phone must be on this network
            </p>
          </>
        )}
        <div className="mt-6 flex justify-center gap-3">
          <ActionButton tone="ghost" onClick={() => void request()}>
            {expired || error ? 'New code' : 'Replace code'}
          </ActionButton>
        </div>
      </Card>
      <div className="flex gap-3">
        <ActionButton tone="ghost" onClick={onBack}>Back</ActionButton>
        <p className="self-center text-sm text-slate-500">This screen moves on by itself when the phone pairs.</p>
      </div>
    </div>
  );
}
