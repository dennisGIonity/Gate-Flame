/**
 * Gate^Flame — app-side pairing screen.
 *
 * Shown on the phone before any node is paired. Discovers a node on the LAN,
 * asks for the six-digit code shown on the kiosk, claims it, and stores the
 * issued device token. On success the caller flips to the paired shell, whose
 * own effect runs gateflameApi.connect().
 *
 * 2026-10-02 pass — same words, different plumbing:
 *   - every discovery run owns an AbortController, cancelled by the next run
 *     and by unmount. "Search again" used to start a second twelve-way race
 *     alongside the first, and whichever finished last won.
 *   - the default device name comes from `deviceName.ts` instead of the first
 *     token of the user agent, which on every Android WebView is "Linux".
 *   - every tap target is at least 48 px tall, inputs are labelled, the code
 *     field asks the keyboard for digits and one-time-code autofill, and the
 *     palette is the app's own (it was the only screen still in Tailwind's
 *     stock emerald/slate).
 *   - the root clears the status bar on an edge-to-edge Android 15+ handset.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverNode, probeNodeAt } from '../services/nodeDiscovery';
import { gateflameApi } from '../services/gateflameApi';
import { ApiRequestError } from '../services/apiClient';
import { defaultDeviceName, refineDeviceName } from '../mobile/deviceName';

type Step = 'discover' | 'enter-code' | 'pairing' | 'done' | 'error';

interface Props {
  onPaired?: () => void;
}

const FIELD =
  'min-h-12 w-full rounded-xl border border-[#1E293B] bg-[#0F1B2D] px-4 text-slate-100 outline-none placeholder:text-[#475569] focus-visible:border-[#38BDF8]/70 focus-visible:ring-2 focus-visible:ring-[#38BDF8]/30';
const PRIMARY =
  'min-h-12 w-full rounded-xl bg-[#38BDF8] px-4 text-sm font-semibold text-[#081018] transition-colors hover:bg-[#5fcbfa] disabled:opacity-40';
const SECONDARY =
  'min-h-12 w-full rounded-xl border border-[#1E293B] bg-[#111A28]/70 px-4 text-sm font-medium text-slate-200 transition-colors hover:bg-[#162236]';
const LINK = 'min-h-12 text-left text-sm text-[#38BDF8] underline decoration-dotted underline-offset-4';

export function AppPairingScreen({ onPaired }: Props) {
  const [step, setStep] = useState<Step>('discover');
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [deviceName, setDeviceName] = useState(() =>
    defaultDeviceName(typeof navigator !== 'undefined' ? navigator.userAgent : null),
  );
  const nameEdited = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  // Discovery finding A node doesn't mean it found the RIGHT one — more than
  // one Gate^Flame box can answer on a LAN (a neighbour's, a second unit being
  // provisioned). Previously the manual-address override only appeared after
  // discovery itself failed, so there was no way to correct a false-positive
  // match short of it erroring out on its own.
  const [showManual, setShowManual] = useState(false);

  // One discovery at a time. The previous run is cancelled before the next
  // starts, and whatever is in flight is cancelled on unmount.
  const inFlight = useRef<AbortController | null>(null);
  const beginRun = () => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    return controller;
  };
  useEffect(() => () => inFlight.current?.abort(), []);

  // Client Hints still carry the real model on a reduced user agent. Only
  // accepted while the owner has not typed a name of their own.
  useEffect(() => {
    let live = true;
    void refineDeviceName().then((model) => {
      if (live && model && !nameEdited.current) setDeviceName(model);
    });
    return () => {
      live = false;
    };
  }, []);

  const runDiscovery = useCallback(async () => {
    const controller = beginRun();
    setStep('discover');
    setError(null);
    try {
      const result = await discoverNode(controller.signal);
      if (controller.signal.aborted) return;
      setBaseUrl(result.baseUrl);
      setNodeName(result.status.nodeName ?? result.status.nodeId);
      setStep('enter-code');
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        err instanceof ApiRequestError
          ? 'No Gate^Flame node found on this network. Make sure your phone is on the same Wi-Fi as the appliance — or enter its address below.'
          : 'Discovery failed.',
      );
      setStep('error');
    }
  }, []);

  // Discovery has to start by itself. Without this the screen said "Looking for
  // a Gate^Flame node…" while doing nothing at all, and the only thing that ever
  // probed the network was the customer pressing "Search again".
  useEffect(() => {
    void runDiscovery();
  }, [runDiscovery]);

  /**
   * Manual fallback. Discovery covers the addresses of the routers we sell; a
   * customer on any other subnet has no other route to their own appliance, and
   * an appliance you cannot reach is an appliance you cannot support.
   */
  const tryManualAddress = async () => {
    const raw = manualAddress.trim();
    if (!raw) return;
    // Accept "192.168.4.20", "192.168.4.20:8080" or a full URL. Default the
    // scheme to http and the port to 8080, which is what the agent binds.
    let candidate = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
    candidate = candidate.replace(/\/+$/, '');
    if (!/:\d+$/.test(candidate.replace(/^https?:\/\//i, ''))) {
      candidate = `${candidate}:8080`;
    }
    const controller = beginRun();
    setStep('discover');
    setError(null);
    try {
      const result = await probeNodeAt(candidate, controller.signal);
      if (controller.signal.aborted) return;
      setBaseUrl(result.baseUrl);
      setNodeName(result.status.nodeName ?? result.status.nodeId);
      setStep('enter-code');
      setShowManual(false);
    } catch {
      if (controller.signal.aborted) return;
      setError(`Nothing that looks like a Gate^Flame node answered at ${candidate}.`);
      setStep('error');
    }
  };

  const submitCode = async () => {
    if (!baseUrl || code.length !== 6 || step === 'pairing') return;
    setStep('pairing');
    setError(null);
    try {
      await gateflameApi.claimPairingCode(baseUrl, code.trim(), deviceName.trim() || 'My phone');
      setStep('done');
      onPaired?.();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        if (err.status === 401) {
          const remaining = (err.body as { attemptsRemaining?: number } | null)?.attemptsRemaining;
          setAttemptsRemaining(remaining ?? null);
          setError(
            remaining === 0
              ? 'Code destroyed after too many wrong guesses. Ask for a new one on the kiosk.'
              : `Wrong code.${remaining != null ? ` ${remaining} attempts left.` : ''}`,
          );
        } else if (err.status === 410) {
          setError('That code expired. Get a fresh one on the kiosk screen.');
        } else if (err.status === 429) {
          setError('Too many attempts too fast — wait a moment and try again.');
        } else {
          setError(err.message);
        }
      } else {
        setError('Pairing failed.');
      }
      setStep('enter-code');
    }
  };

  return (
    <div
      className="mx-auto flex w-full max-w-md flex-col gap-4 px-6 pb-8 sm:max-w-lg"
      style={{ paddingTop: 'calc(var(--gf-safe-top) + 1.5rem)' }}
    >
      <h2 className="text-xl font-semibold tracking-tight text-slate-100 sm:text-2xl">
        Connect to your Gate^Flame node
      </h2>

      {step === 'discover' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-slate-400" role="status">
            Looking for a Gate^Flame node on your Wi-Fi…
          </p>
          <button type="button" onClick={() => void runDiscovery()} className={SECONDARY}>
            Search again
          </button>
        </div>
      )}

      {(step === 'enter-code' || step === 'pairing') && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
        >
          <p className="text-sm text-slate-400">
            Found: {nodeName}. Enter the code shown on your Gate^Flame screen.
          </p>
          <label htmlFor="gf-pair-code" className="sr-only">
            Six-digit pairing code
          </label>
          <input
            id="gf-pair-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            enterKeyHint="go"
            placeholder="000000"
            className={`${FIELD} py-3 text-center font-mono text-2xl tracking-[0.3em]`}
          />
          <label htmlFor="gf-device-name" className="sr-only">
            This phone&rsquo;s name
          </label>
          <input
            id="gf-device-name"
            value={deviceName}
            onChange={(e) => {
              nameEdited.current = true;
              setDeviceName(e.target.value);
            }}
            maxLength={48}
            autoCapitalize="words"
            enterKeyHint="go"
            placeholder="This phone's name"
            className={FIELD}
          />
          <button type="submit" disabled={code.length !== 6 || step === 'pairing'} className={PRIMARY}>
            {step === 'pairing' ? 'Pairing…' : 'Pair'}
          </button>
          {error && (
            <p className="text-sm text-[#FB7185]" role="alert">
              {error}
            </p>
          )}
          {attemptsRemaining === 0 && (
            <button type="button" onClick={() => void runDiscovery()} className={LINK}>
              Start over
            </button>
          )}
          {!showManual && (
            <button type="button" onClick={() => setShowManual(true)} className={LINK}>
              Not the right node? Connect to a specific address
            </button>
          )}
        </form>
      )}

      {step === 'done' && (
        <p className="text-sm text-[#10B981]" role="status">
          Paired. Loading your node…
        </p>
      )}

      {step === 'error' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-[#FB7185]" role="alert">
            {error}
          </p>
          <button type="button" onClick={() => void runDiscovery()} className={SECONDARY}>
            Try again
          </button>
        </div>
      )}

      {(step === 'error' || showManual) && (
        <form
          className="mt-2 flex flex-col gap-2 border-t border-[#1E293B] pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void tryManualAddress();
          }}
        >
          <label htmlFor="gf-manual-address" className="text-sm text-slate-400">
            Know the node&rsquo;s address? Enter it here.
          </label>
          <input
            id="gf-manual-address"
            value={manualAddress}
            onChange={(e) => setManualAddress(e.target.value)}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="192.168.4.20"
            className={`${FIELD} font-mono`}
          />
          <p className="text-xs text-[#64748B]">Port 8080 is assumed unless you type a different one.</p>
          <button type="submit" disabled={manualAddress.trim().length === 0} className={PRIMARY}>
            Connect
          </button>
        </form>
      )}
    </div>
  );
}
