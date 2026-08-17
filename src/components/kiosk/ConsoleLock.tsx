/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: lock screen
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The first screen. What a "login" honestly means on this device.
 *
 * There is no account here and there is no password, because the node does not
 * authenticate the console — it authorises it by SOCKET. `kiosk` scope is
 * granted to a loopback connection and to nothing else (security.py), which is
 * a statement about physical presence: whoever is touching this panel is
 * standing in the house. A username and password field would be pure decoration
 * over a decision that was already made at the TCP layer.
 *
 * So this screen does the two useful things a lock screen can actually do here:
 *
 *   1. It tells the household whether they are protected WITHOUT being
 *      unlocked. A wall panel that must be woken to answer "is my network
 *      filtered?" has failed at its main job. Protection status, node identity
 *      and the clock are all readable from across the room, locked.
 *
 *   2. It stops a passer-by — a guest, a child, a cleaner — from tapping
 *      "pause filtering" on their way past. It does that with a deliberate
 *      press-and-hold, which is the honest UI analogue of physical presence.
 *      It is a guard against accident, and it is described that way in the
 *      copy. It is NOT a defence against someone who wants in: anyone who can
 *      touch the panel can also unplug the box.
 *
 * A REAL console PIN needs a node-side route, because a code checked in
 * JavaScript that the node itself serves is theatre. The contract is drafted in
 * docs (POST /api/v1/console/unlock → short-lived console session) and this
 * component already takes the `verifyPin` seam for it. Until that route exists,
 * the seam is null and the screen says so rather than pretending.
 */

import { useEffect, useState } from 'react';
import { Lock, ShieldCheck, ShieldOff, ShieldAlert, Wifi, WifiOff } from 'lucide-react';

import { HoldButton } from './kioskUi';
import type { ProtectionStatus } from '../../types/filtering';
import { DASH } from './kioskClient';
import type { ConsoleAuthority } from './kioskClient';

export interface ConsoleLockProps {
  nodeId: string | null;
  agentVersion: string | null;
  protection: ProtectionStatus | null;
  protectionDetail: string | null;
  reachable: boolean;
  /** The node answered and refused: reads need scope this page does not have. */
  refused: boolean;
  authority: ConsoleAuthority;
  /** Null until a node-side console-lock route exists. See the header note. */
  verifyPin: ((pin: string) => Promise<boolean>) | null;
  onUnlock: () => void;
}

const PROTECTION_FACE: Record<
  ProtectionStatus,
  { icon: typeof ShieldCheck; text: string; colour: string; glow: string }
> = {
  active: {
    icon: ShieldCheck,
    text: 'Protected',
    colour: 'text-[#10B981]',
    glow: 'shadow-[0_0_80px_rgba(16,185,129,0.18)]',
  },
  // Off because the owner asked. Their choice — but it must still LOOK off.
  paused: {
    icon: ShieldOff,
    text: 'Filtering paused',
    colour: 'text-[#F59E0B]',
    glow: 'shadow-[0_0_80px_rgba(245,158,11,0.2)]',
  },
  // Off because the box failed. Same exposure, completely different remedy.
  bypass: {
    icon: ShieldAlert,
    text: 'Unprotected — fault',
    colour: 'text-[#E11D48]',
    glow: 'shadow-[0_0_80px_rgba(225,29,72,0.22)]',
  },
};

export default function ConsoleLock({
  nodeId,
  agentVersion,
  protection,
  protectionDetail,
  reachable,
  refused,
  authority,
  verifyPin,
  onUnlock,
}: ConsoleLockProps) {
  const [now, setNow] = useState(() => new Date());
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const face = protection ? PROTECTION_FACE[protection] : null;
  const Icon = face?.icon ?? Lock;

  const submitPin = async () => {
    if (!verifyPin || pin.length < 4) return;
    setChecking(true);
    setPinError(null);
    try {
      const ok = await verifyPin(pin);
      if (ok) onUnlock();
      else {
        setPinError('That code was not accepted.');
        setPin('');
      }
    } catch {
      setPinError('The node could not check that code.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#080D16] px-10 text-slate-200 antialiased">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(0,111,211,0.10)_0%,transparent_68%)]" />

      {/* Clock — the panel is furniture as well as an instrument. */}
      <div className="relative mb-10 text-center">
        <p className="font-mono text-7xl tabular-nums tracking-tight text-slate-100">
          {now.toLocaleTimeString('en-ZA', { hour12: false, hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="mt-2 text-sm uppercase tracking-[0.3em] text-slate-500">
          {now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/*
        Readable while locked. If the node is unreachable this says so instead
        of showing the last known status, because a stale shield is worse than
        no shield: it is a claim about right now.
      */}
      <div
        className={`relative flex flex-col items-center rounded-3xl border border-[#1E293B] bg-[#111A28]/80 px-16 py-10 backdrop-blur-md ${
          reachable ? (face?.glow ?? '') : 'shadow-[0_0_80px_rgba(225,29,72,0.2)]'
        }`}
      >
        {reachable && refused ? (
          <>
            <Lock className="h-20 w-20 text-[#F59E0B]" strokeWidth={1.4} />
            <p className="mt-5 text-4xl font-light tracking-tight text-[#F59E0B]">Protection status withheld</p>
            <p className="mt-3 max-w-md text-center text-base text-slate-400">
              The node is running and answered this page, but it will not report filtering state to a browser on
              the network. Read it on the appliance's own screen, or in the paired app.
            </p>
          </>
        ) : reachable ? (
          <>
            <Icon className={`h-20 w-20 ${face?.colour ?? 'text-slate-600'}`} strokeWidth={1.4} />
            <p className={`mt-5 text-4xl font-light tracking-tight ${face?.colour ?? 'text-slate-500'}`}>
              {face?.text ?? 'Checking protection…'}
            </p>
            {protectionDetail && (
              <p className="mt-3 max-w-md text-center text-base text-slate-400">{protectionDetail}</p>
            )}
          </>
        ) : (
          <>
            <WifiOff className="h-20 w-20 text-[#E11D48]" strokeWidth={1.4} />
            <p className="mt-5 text-4xl font-light tracking-tight text-[#E11D48]">Node unreachable</p>
            <p className="mt-3 max-w-md text-center text-base text-slate-400">
              This display cannot reach the agent, so it cannot tell you whether the network is filtered. Do not
              read anything into the absence of a warning.
            </p>
          </>
        )}
      </div>

      {/* Unlock */}
      <div className="relative mt-12 flex flex-col items-center gap-4">
        {verifyPin ? (
          <div className="flex flex-col items-center gap-3">
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              onKeyDown={(e) => e.key === 'Enter' && void submitPin()}
              placeholder="Console code"
              className="h-14 w-64 rounded-xl border border-[#1E293B] bg-[#0F1B2D] text-center font-mono text-2xl tracking-[0.5em] text-slate-100 outline-none focus:border-[#38BDF8]"
            />
            <HoldButton
              label={checking ? 'Checking…' : 'Unlock console'}
              tone="primary"
              ms={600}
              disabled={checking || pin.length < 4}
              onConfirm={() => void submitPin()}
            />
            {pinError && <p className="text-sm text-[#E11D48]">{pinError}</p>}
          </div>
        ) : (
          <>
            <HoldButton
              label="Hold to unlock"
              holdingLabel="Unlocking…"
              tone="primary"
              ms={1200}
              onConfirm={onUnlock}
              className="px-10 py-5 text-base"
            />
            <p className="max-w-xl text-center text-sm leading-relaxed text-slate-500">
              {authority === 'console' ? (
                <>
                  This console is unlocked by physical presence — anyone standing at the appliance can open it.
                  The hold is there to prevent an accidental touch, not to keep anyone out. To require a code, or
                  to change settings from elsewhere, pair a phone.
                </>
              ) : (
                <>
                  You are viewing this console over the network, so it opens read-only. Controls that change
                  filtering, modules or paired devices are granted only to a connection from the appliance
                  itself.
                </>
              )}
            </p>
          </>
        )}
      </div>

      {/* Identity footer — from the API, never a literal. */}
      <footer className="absolute bottom-8 flex items-center gap-6 text-xs uppercase tracking-[0.25em] text-[#475569]">
        <span className="flex items-center gap-2">
          {authority === 'console' ? <Lock className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
          {authority === 'console' ? 'Appliance console' : 'Remote view'}
        </span>
        <span>Ionity Gate^Flame Node</span>
        <span className="font-mono normal-case tracking-normal text-slate-500">
          {nodeId ?? DASH} · v{agentVersion ?? DASH}
        </span>
      </footer>
    </div>
  );
}
