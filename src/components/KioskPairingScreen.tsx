/**
 * Gate^Flame — kiosk pairing screen.
 *
 * Shown on the appliance's own touchscreen. Displays the six-digit code the
 * customer types into their phone. Nothing here ever leaves the device: the
 * code is requested over loopback (kiosk scope) and rendered locally.
 *
 * See docs/PAIRING-AND-TELEMETRY.md §3 for the full contract this implements:
 * 5-minute validity, single use, destroyed after 5 wrong guesses on the node
 * side — this screen just reflects that state, it doesn't enforce it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { gateflameApi } from '../services/gateflameApi';
import { useConnection } from '../hooks/useConnection';

type Phase = 'idle' | 'requesting' | 'showing' | 'expired' | 'error';

export function KioskPairingScreen() {
  const connection = useConnection();
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const expiresAtRef = useRef<number | null>(null);

  const requestCode = useCallback(async () => {
    setPhase('requesting');
    setError(null);
    try {
      const res = await gateflameApi.requestPairingCode();
      setCode(res.code);
      expiresAtRef.current = new Date(res.expiresAt).getTime();
      setPhase('showing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request a pairing code.');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (phase !== 'showing') return;
    const tick = () => {
      const remaining = Math.max(0, Math.round(((expiresAtRef.current ?? 0) - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) setPhase('expired');
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase]);

  const isLive = connection.dataSource === 'live';

  return (
    <div className="flex flex-col items-center justify-center gap-6 p-8 text-center">
      <h2 className="text-2xl font-semibold tracking-wide">Pair a phone</h2>

      {!isLive && (
        <p className="text-sm text-amber-400">
          This screen needs a live connection to the node's own agent to issue a real code —
          pairing cannot run against simulated data.
        </p>
      )}

      {isLive && phase === 'idle' && (
        <button
          onClick={requestCode}
          className="rounded-lg bg-emerald-600 px-6 py-3 text-lg font-medium text-white hover:bg-emerald-500"
        >
          Show pairing code
        </button>
      )}

      {phase === 'requesting' && <p className="text-lg opacity-70">Requesting code…</p>}

      {phase === 'showing' && code && (
        <>
          <div className="font-mono text-6xl font-bold tracking-[0.3em]">{code}</div>
          <p className="text-sm opacity-70">
            Enter this on your phone within {secondsLeft}s. Wrong 5 times and it's destroyed.
          </p>
        </>
      )}

      {phase === 'expired' && (
        <>
          <p className="text-lg text-amber-400">Code expired.</p>
          <button
            onClick={requestCode}
            className="rounded-lg bg-emerald-600 px-6 py-3 font-medium text-white hover:bg-emerald-500"
          >
            Get a new code
          </button>
        </>
      )}

      {phase === 'error' && (
        <>
          <p className="text-sm text-red-400">{error}</p>
          <button
            onClick={requestCode}
            className="rounded-lg bg-slate-700 px-6 py-3 font-medium text-white hover:bg-slate-600"
          >
            Retry
          </button>
        </>
      )}
    </div>
  );
}
