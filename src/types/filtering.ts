/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame filtering control contract
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The owner's writable surface, typed.
 *
 * Mirrors `_filtering_state_payload()` in node-agent/gateflame/main.py exactly.
 * Written as its own module rather than appended to types/api.ts because the
 * phone app needs the identical contract, and END-GAME PLAN §3.7 asks for the
 * type to exist BEFORE the screen that consumes it — the interface is the seam
 * both sides build against.
 *
 * Two axes, deliberately separate (see content_categories.py's header):
 *
 *   threatLevel   how much DANGER is blocked   — always on, three levels
 *   categories    what CONTENT is blocked      — every one off by default
 */

/** Ordered low → high. The node rejects anything else with a 400. */
export type ThreatLevelId = 'low' | 'medium' | 'high';

/**
 * Three values, and they are blunt on purpose:
 *   active  filtering, household protected
 *   paused  off because the OWNER asked — their choice, shown clearly
 *   bypass  off because the BOX FAILED — dns-watchdog.sh fell back
 *
 * `paused` and `bypass` are both unprotected and must both look unprotected.
 * They are distinguished because the remedy differs completely: one is a button,
 * the other is a fault.
 */
export type ProtectionStatus = 'active' | 'paused' | 'bypass';

export type PauseDurationId = '5m' | '30m' | '2h' | 'until_reboot' | 'indefinite';

export interface ThreatLevelState {
  level: ThreatLevelId;
  description: string;
  blocklistCount: number;
}

export interface ContentCategory {
  id: string;
  label: string;
  description: string;
  /** Non-null when turning this on can break something the owner uses. Render it. */
  caution: string | null;
  enabled: boolean;
}

export interface PauseDuration {
  id: PauseDurationId;
  label: string;
  /** `until_reboot` and `indefinite`. Not forbidden — just not tapped by accident. */
  requiresConfirmation: boolean;
}

export interface FilteringState {
  protectionStatus: ProtectionStatus;
  enabled: boolean;
  /** Unix seconds. Null when active, or when paused indefinitely. */
  pausedUntil: number | null;
  secondsRemaining: number | null;
  durationLabel: string | null;
  /** Free text the owner typed, echoed back so whoever finds it off knows why. */
  reason: string | null;
  threatLevel: ThreatLevelState;
  availableLevels: ThreatLevelState[];
  categories: ContentCategory[];
  pauseDurations: PauseDuration[];
}

export interface PauseRequest {
  duration: PauseDurationId;
  reason?: string;
}
