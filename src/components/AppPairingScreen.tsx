/**
 * Gate^Flame — app-side pairing screen.
 *
 * Shown on the phone before any node is paired. Discovers a node on the LAN,
 * asks for the six-digit code shown on the kiosk, claims it, and stores the
 * issued device token. On success the caller should re-run
 * gateflameApi.connect() so useConnection picks up the new `live` state.
 */

import { useCallback, useEffect, useState } from 'react';
import { discoverNode, probeNodeAt } from '../services/nodeDiscovery';
import { gateflameApi } from '../services/gateflameApi';
import { ApiRequestError } from '../services/apiClient';

type Step = 'discover' | 'enter-code' | 'pairing' | 'done' | 'error';

interface Props {
  onPaired?: () => void;
}

export function AppPairingScreen({ onPaired }: Props) {
  const [step, setStep] = useState<Step>('discover');
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [nodeName, setNodeName] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [deviceName, setDeviceName] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.userAgent.split('(')[1]?.split(';')[0] ?? 'My phone' : 'My phone',
  );
  const [error, setError] = useState<string | null>(null);
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const runDiscovery = useCallback(async () => {
    setStep('discover');
    setError(null);
    try {
      const result = await discoverNode();
      setBaseUrl(result.baseUrl);
      setNodeName(result.status.nodeName ?? result.status.nodeId);
      setStep('enter-code');
    } catch (err) {
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
    setStep('discover');
    setError(null);
    try {
      const result = await probeNodeAt(candidate);
      setBaseUrl(result.baseUrl);
      setNodeName(result.status.nodeName ?? result.status.nodeId);
      setStep('enter-code');
    } catch {
      setError(`Nothing that looks like a Gate^Flame node answered at ${candidate}.`);
      setStep('error');
    }
  };

  const submitCode = async () => {
    if (!baseUrl) return;
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
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-xl font-semibold">Connect to your Gate^Flame node</h2>

      {step === 'discover' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">Looking for a Gate^Flame node on your Wi-Fi…</p>
          <button
            onClick={runDiscovery}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
          >
            Search again
          </button>
        </div>
      )}

      {(step === 'enter-code' || step === 'pairing') && (
        <div className="flex flex-col gap-3">
          <p className="text-sm opacity-70">Found: {nodeName}. Enter the code shown on your Gate^Flame screen.</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            placeholder="000000"
            className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-white"
          />
          <input
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="This phone's name"
            className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-white"
          />
          <button
            onClick={submitCode}
            disabled={code.length !== 6 || step === 'pairing'}
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {step === 'pairing' ? 'Pairing…' : 'Pair'}
          </button>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {attemptsRemaining === 0 && (
            <button onClick={runDiscovery} className="text-sm underline opacity-70">
              Start over
            </button>
          )}
        </div>
      )}

      {step === 'done' && <p className="text-emerald-400">Paired. Loading your node…</p>}

      {step === 'error' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={runDiscovery}
            className="rounded-lg bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600"
          >
            Try again
          </button>

          <div className="mt-2 flex flex-col gap-2 border-t border-slate-700 pt-3">
            <label htmlFor="gf-manual-address" className="text-sm opacity-70">
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
              placeholder="192.168.4.20"
              className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 font-mono text-white"
            />
            <p className="text-xs opacity-50">Port 8080 is assumed unless you type a different one.</p>
            <button
              onClick={tryManualAddress}
              disabled={manualAddress.trim().length === 0}
              className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
            >
              Connect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
