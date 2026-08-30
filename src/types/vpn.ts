/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame Shield (per-device VPN) contract
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Mirrors node-agent/gateflame/vpn.py exactly, same discipline as
 * types/filtering.ts. Nothing here says WireGuard, Headscale or Tailscale —
 * this screen is a native Gate^Flame capability, and `label` below is the
 * ONE place the customer-facing name is allowed to come from, so relabelling
 * the whole feature is a one-line change on the node, not a hunt through
 * this file.
 */

export interface VpnRegion {
  /** e.g. "uk", "us" — whatever the exit node was tagged with at setup. */
  code: string;
  /** Friendly name if the node recognises the code, else the code itself. */
  label: string;
  /** False means listed but not currently reachable - shown, not hidden. */
  available: boolean;
}

export interface VpnRegionsResponse {
  /** The customer-facing name for this whole feature. Render this, not a
   * hardcoded string, so one change on the node relabels every screen. */
  label: string;
  /** False before the control plane exists at all - distinct from having
   * zero regions on an otherwise-working control plane. */
  controlPlaneReachable: boolean;
  regions: VpnRegion[];
}

export interface VpnDeviceState {
  mac: string;
  region: string | null;
  enabled: boolean;
  /** Whether the box has actually issued this device a working peer config,
   * as opposed to merely recording the owner's choice. */
  peerRegistered: boolean;
  updatedAt?: number;
  /** Present only on a write response. A rebuild/registration is running. */
  applying?: boolean;
  /** Present only on a write response. Null when nothing is wrong. */
  lastError?: string | null;
}

export interface VpnDevicesResponse {
  devices: VpnDeviceState[];
}
