/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame API types: network setup
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Typed from node-agent/gateflame/network_setup.py, not from a description of it.
 *
 *   GET  /api/v1/network/status        read   -> NetworkStatus
 *   GET  /api/v1/network/wifi/scan     kiosk  -> WifiScan
 *   POST /api/v1/network/wifi/connect  kiosk  -> 200 { ok: true, address } | 4xx { ok: false, error, detail }
 *   POST /api/v1/network/wifi/forget   kiosk  -> { ok: true, forgotten: string | null }
 *
 * The router read-back is RouterCheckResponse in ./routerCheck.
 *
 * `gap` is the node's own sentence for "could not read this", and it is rendered
 * verbatim. `internet: null` means the probe itself could not be made - it is
 * never drawn as "no internet".
 */

export interface NetworkStatus {
  wired: { present: boolean; up: boolean; address: string | null };
  wifi: {
    present: boolean;
    connected: boolean;
    ssid: string | null;
    address: string | null;
    /** 0-100, or null when not connected / not readable. */
    signal: number | null;
  };
  /** The address the router's DNS should be set to: wired first. */
  boxAddress: string | null;
  internet: boolean | null;
  gap: string | null;
}

export interface WifiNetwork {
  ssid: string;
  signal: number;
  /** "open" or the security string NetworkManager reports (WPA2, WPA3, ...). */
  security: string;
}

export interface WifiScan {
  networks: WifiNetwork[];
  gap: string | null;
}

export interface WifiConnectResponse {
  ok: boolean;
  /** The address DHCP handed out, or null when it had not arrived yet. */
  address?: string | null;
}
