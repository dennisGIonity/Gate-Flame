/**
 * The five protection states, as the phone words them.
 *
 * `protectionStatus` has FIVE values (types/filtering.ts, node-agent main.py),
 * and a surface that knows three renders the other two as whatever its `else`
 * happens to say. Settings did exactly that until 2026-10-03: it checked
 * `paused`, then fell back to `enabled ? 'on' : 'off'`. Today's agent forces
 * `enabled: false` on every fault, so a box that had FAILED read as the owner's
 * own switch, "off"; and any agent that sends `enabled: true` alongside a fault
 * got a green "on" over a box that was blocking nothing.
 *
 * Record<ProtectionStatus, …>, not Record<string, …>: the compiler refuses a
 * build that forgets a state. Same shape as PROTECTION_COPY on the console
 * (components/kiosk/panels.tsx), and the three fault qualifiers below are the
 * console's own words, so the box and the phone name a fault the same way. Not
 * imported from there: that is the console's panel module, and a chip needs a
 * one-word label its long headlines do not have.
 *
 *   active        protected
 *   paused        paused                           the owner's choice
 *   bypass        unprotected · the box fell back  the box failed over
 *   degraded      unprotected · not blocking       up, and not blocking
 *   unconfigured  unprotected · setup incomplete   no Pi-hole to drive
 *
 * Never the raw token. And never `reason` on a fault: that field is what the
 * owner typed when PAUSING, so on bypass it is empty and reads as though we
 * forgot to ask. Every unprotected state looks equally unprotected; they differ
 * only so the remedy can be named.
 */

import type { ProtectionStatus } from '../types/filtering';
import { Chip, DASH } from './mobileUi';

export interface ProtectionLook {
  /** One word for a chip. CSS upper-cases it; the DOM keeps it readable. */
  label: string;
  /** For the three faults: which kind, so the remedy can differ. */
  qualifier: string | null;
  tone: 'good' | 'warn' | 'fault';
}

export const PROTECTION_LOOK: Record<ProtectionStatus, ProtectionLook> = {
  active: { label: 'protected', qualifier: null, tone: 'good' },
  paused: { label: 'paused', qualifier: null, tone: 'warn' },
  bypass: { label: 'unprotected', qualifier: 'the box fell back', tone: 'fault' },
  degraded: { label: 'unprotected', qualifier: 'not blocking', tone: 'fault' },
  unconfigured: { label: 'unprotected', qualifier: 'setup incomplete', tone: 'fault' },
};

/**
 * The look for a status, or null for a value this build does not know.
 *
 * Own-property lookup, not `in`: `'toString' in PROTECTION_LOOK` is true.
 * A sixth value from a newer agent renders as the dash - never as its raw
 * token, and never as a guess at which of the five it resembles.
 */
export function protectionLook(status: string | null | undefined): ProtectionLook | null {
  if (!status || !Object.prototype.hasOwnProperty.call(PROTECTION_LOOK, status)) return null;
  return PROTECTION_LOOK[status as ProtectionStatus];
}

export function ProtectionChip({ status }: { status: string | null | undefined }) {
  const look = protectionLook(status);
  if (!look) return <Chip tone="slate">{DASH}</Chip>;
  return (
    <span className="flex flex-col items-end gap-1 text-right">
      <Chip tone={look.tone}>{look.label}</Chip>
      {look.qualifier && (
        <span className="max-w-[9.5rem] font-mono text-[9px] font-semibold uppercase leading-snug tracking-wider text-[#E11D48]">
          {look.qualifier}
        </span>
      )}
    </span>
  );
}
