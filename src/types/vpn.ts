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

/**
 * Two providers, one screen. "headscale" is Ionity's own exit servers, once
 * at least one is deployed - verified, controlled, [] until it exists.
 * "vpngate" is the free public VPN Gate relay network (node-agent's
 * vpngate.py) - real countries at zero budget, but best-effort: VPN Gate is
 * an academic project that discloses its own connection-metadata logging,
 * and published research has documented a MitM risk on its volunteer nodes.
 * NEVER render vpngate regions as "audited" or "no-logs" - that would be a
 * false claim about the network underneath them. See docs/VPN-SHIELD-DESIGN.md.
 */
export type VpnProvider = 'headscale' | 'vpngate';

export interface VpnRegion {
  /** e.g. "uk" for headscale, "US"/"JP" for vpngate — provider-specific. */
  code: string;
  /** Friendly name if the node recognises the code, else the code itself. */
  label: string;
  provider: VpnProvider;
  /** False means listed but not currently reachable - shown, not hidden. */
  available: boolean;
  /** vpngate only - how many volunteer servers currently back this country. */
  serverCount?: number;
}

export interface VpnRegionsResponse {
  /** The customer-facing name for this whole feature. Render this, not a
   * hardcoded string, so one change on the node relabels every screen. */
  label: string;
  /** False before Ionity's own control plane exists at all - distinct from
   * having zero regions on an otherwise-working control plane. */
  controlPlaneReachable: boolean;
  /** True once VPN Gate's public list has been read successfully at least
   * once. Independent of controlPlaneReachable - a box can have plenty of
   * one and none of the other. */
  vpnGateAvailable: boolean;
  /** The box is fetching VPN Gate's list right now. Lets a screen tell "still
   * loading" apart from "nothing on offer" instead of guessing - an empty
   * `regions` means both, and guessing wrong told owners a working feature
   * had never been installed. Optional: an older agent will not send it. */
  refreshing?: boolean;
  regions: VpnRegion[];
}

/**
 * One tile per continent that currently has at least one VPN Gate server,
 * already resolved to its own best country - picking a continent tile is
 * exactly picking `bestCountryCode` directly, nothing downstream needs to
 * know continents exist. See vpngate.py's list_continents().
 */
export interface VpnContinent {
  code: string;
  label: string;
  provider: 'vpngate';
  available: boolean;
  bestCountryCode: string;
  bestCountryLabel: string;
  countryCount: number;
  serverCount: number;
}

export interface VpnContinentsResponse {
  continents: VpnContinent[];
}

/** One device's live VPN Gate config, fetched fresh each time - never cached
 * against the device, since VPN Gate's own server list rotates. */
export interface VpnGateConfigResponse {
  available: boolean;
  error: string | null;
  countryCode?: string;
  countryName?: string;
  hostname?: string;
  ip?: string;
  score?: number | null;
  pingMs?: number | null;
  speedMbps?: number | null;
  configText?: string;
}

export interface VpnDeviceState {
  mac: string;
  region: string | null;
  enabled: boolean;
  /** Whether the box has actually issued this device a working peer config,
   * as opposed to merely recording the owner's choice. */
  peerRegistered: boolean;
  provider?: VpnProvider;
  updatedAt?: number;
  /** Present only on a write response. A rebuild/registration is running. */
  applying?: boolean;
  /** Present only on a write response. Null when nothing is wrong. */
  lastError?: string | null;
}

export interface VpnDevicesResponse {
  devices: VpnDeviceState[];
}
