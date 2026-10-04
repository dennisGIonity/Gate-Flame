/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame API types: router read-back
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * GET /api/v1/network/router-check  (scope `read`)
 *
 * ADR-001's one customer action is "point your router's DNS at this box". This
 * is that action read back: does the router actually send lookups here?
 *
 * Typed from the contract agreed on 2026-10-03 while the route was being built
 * alongside the screens that read it (the kiosk setup step and the phone's
 * Network screen), so both build against this one seam. If the node's payload
 * and this file ever disagree, this file is what is wrong.
 *
 * `forwardsToUs` is three-valued, and the third value is the reason this type
 * exists rather than a boolean:
 *
 *   true    the router's lookups reach this box
 *   false   checked, and they do not
 *   null    could not tell. `gap` says why, in the node's words. NEVER rendered
 *           as "not forwarding": undetermined is not false (CLAUDE.md, "Never
 *           do": act on `gateway_forwards_to_us is None`).
 */
export interface RouterCheckResponse {
  /** The household router's address, or null when none was found. */
  gateway: string | null;
  /** The address the router's DNS should be set to: this box. */
  boxAddress: string | null;
  forwardsToUs: boolean | null;
  /** How it was decided. Engineering detail, not shown to a customer. */
  method: 'canary' | string | null;
  /** Box clock, Unix seconds. Not shown: the box's clock can be days off. */
  checkedAt: number | null;
  /** e.g. "Pi-hole unreachable", "no gateway found", "router did not answer the canary query". */
  gap: string | null;
}
