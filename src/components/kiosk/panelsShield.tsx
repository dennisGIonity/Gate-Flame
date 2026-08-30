/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: Shield (per-device VPN)
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Gate^Flame Shield existed on the phone (mobile/screens/ControlsScreen.tsx)
 * and nowhere else — not here, not on the kiosk console. The mobile version
 * remains the reference implementation (it also hands a fetched .ovpn file to
 * the OS share sheet, which has no analogue on a wall panel); this port
 * covers everything a customer or Dennis would actually reach for at the
 * appliance itself: see which devices Shield is on for, and turn it on/off
 * with a region. Same node routes (node-agent/gateflame/vpn.py), same
 * kioskApi client, same "never invent a device" rule as NetworkPanel.
 */

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { kioskApi, usePolled, type LanClient } from './kioskClient';
import { ActionButton, Card, EmptyState, ViewerNotice } from './kioskUi';
import type { PanelContext } from './panels';
import type {
  VpnContinentsResponse,
  VpnDevicesResponse,
  VpnGateConfigResponse,
  VpnProvider,
  VpnRegionsResponse,
} from '../../types/vpn';

interface ShieldRow {
  mac: string;
  label: string;
  region: string | null;
  enabled: boolean;
  peerRegistered: boolean;
  provider: VpnProvider;
}

export function ShieldPanel({ authority, active }: PanelContext) {
  const canWrite = authority === 'console';

  // Regions barely change; devices matter more often. Same interval choice
  // as the mobile screen, for the same reason — see ControlsScreen.tsx.
  const regions = usePolled<VpnRegionsResponse>('/vpn/regions', 20000, active);
  const continents = usePolled<VpnContinentsResponse>('/vpn/continents', 20000, active);
  const devices = usePolled<VpnDevicesResponse>('/vpn/devices', 20000, active);
  const clients = usePolled<{ clients: LanClient[] }>('/clients', 20000, active);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [configResult, setConfigResult] = useState<VpnGateConfigResponse | null>(null);

  const r = regions.data;
  const continentList = continents.data?.continents ?? [];
  const knownDevices = devices.data?.devices ?? [];
  const lanList = clients.data?.clients ?? [];

  // A device the box has seen counts even with no Shield row yet (reads as
  // "off"); a device with a Shield row but no longer on the LAN still shows,
  // since turning ITS tunnel off is still something worth doing from here.
  const byMac = new Map(knownDevices.map((d) => [d.mac, d]));
  const rows: ShieldRow[] = [
    ...lanList.map((c) => ({
      mac: c.mac,
      // Computed on the node (device_names.py) so this console and the phone
      // always call a device the same thing. Falls back for older agents.
      label: c.label || c.hostname || c.mac,
      region: byMac.get(c.mac)?.region ?? null,
      enabled: byMac.get(c.mac)?.enabled ?? false,
      peerRegistered: byMac.get(c.mac)?.peerRegistered ?? false,
      provider: byMac.get(c.mac)?.provider ?? 'headscale',
    })),
    ...knownDevices
      .filter((d) => !lanList.some((c) => c.mac === d.mac))
      .map((d) => ({
        mac: d.mac,
        label: d.mac,
        region: d.region,
        enabled: d.enabled,
        peerRegistered: d.peerRegistered,
        provider: d.provider ?? 'headscale',
      })),
  ];

  async function setDevice(mac: string, region: string | null, enabled: boolean, provider: VpnProvider) {
    setBusy(`shield-${mac}`);
    setError(null);
    setConfigFor(null);
    try {
      const result = await kioskApi.setVpnDevice(mac, region, enabled, provider);
      if (result.lastError) setError(result.lastError);
      devices.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  async function downloadConfig(mac: string) {
    setBusy(`shield-config-${mac}`);
    setConfigResult(null);
    try {
      setConfigResult(await kioskApi.getVpnGateConfig(mac));
      setConfigFor(mac);
    } catch (err) {
      setConfigResult({ available: false, error: err instanceof Error ? err.message : 'That did not go through.' });
      setConfigFor(mac);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      {error && (
        <div className="col-span-12 rounded-xl border border-[#E11D48]/50 bg-[#E11D48]/10 px-5 py-4 text-sm text-[#E11D48]">
          {error}
        </div>
      )}

      <Card
        className="col-span-12"
        title={r?.label ?? 'Gate^Flame Shield'}
        subtitle="Per-device VPN. Pick a device the box has seen, then a region — same control the paired phone has."
      >
        {!canWrite && <ViewerNotice what="Gate^Flame Shield" />}

        {!r || r.regions.length === 0 ? (
          <EmptyState
            title={
              !r || (!r.controlPlaneReachable && !r.vpnGateAvailable)
                ? 'Not set up on this box yet'
                : 'No regions available right now'
            }
            detail={
              !r || (!r.controlPlaneReachable && !r.vpnGateAvailable)
                ? 'Nothing to turn on until Ionity’s control plane or VPN Gate is reachable from this box.'
                : 'The box is configured, but neither provider has an available region at the moment.'
            }
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No devices seen yet"
            detail={clients.data ? 'No devices seen on your network yet.' : 'Reading your devices…'}
          />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {rows.map((row) => (
              <div key={row.mac} className="rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-slate-100">{row.label}</p>
                    <p className="font-mono text-xs text-slate-500">{row.mac}</p>
                  </div>
                  <ActionButton
                    tone={row.enabled ? 'primary' : 'ghost'}
                    disabled={!canWrite || busy !== null}
                    onClick={() => {
                      const fallback = r.regions[0];
                      setDevice(
                        row.mac,
                        row.region ?? fallback?.code ?? null,
                        !row.enabled,
                        row.region ? row.provider : (fallback?.provider ?? 'headscale'),
                      );
                    }}
                  >
                    {row.enabled ? 'On' : 'Off'}
                  </ActionButton>
                </div>

                {row.enabled && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {r.regions.map((reg) => (
                      <button
                        key={`${reg.provider}-${reg.code}`}
                        disabled={!canWrite || busy !== null || !reg.available}
                        onClick={() => setDevice(row.mac, reg.code, true, reg.provider)}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
                          reg.code === row.region && reg.provider === row.provider
                            ? 'border-[#38BDF8]/60 bg-[#38BDF8]/10 text-[#38BDF8]'
                            : 'border-[#1E293B] bg-[#0B1420] text-slate-300'
                        }`}
                      >
                        {reg.label}
                        {reg.provider === 'vpngate' && <span className="text-slate-500"> · community</span>}
                        {!reg.available && ' (offline)'}
                      </button>
                    ))}
                    {continentList.map((c) => (
                      <button
                        key={c.code}
                        disabled={!canWrite || busy !== null || !c.available}
                        onClick={() => setDevice(row.mac, c.bestCountryCode, true, 'vpngate')}
                        className={`rounded-lg border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
                          row.provider === 'vpngate' && row.region === c.bestCountryCode
                            ? 'border-[#38BDF8]/60 bg-[#38BDF8]/10 text-[#38BDF8]'
                            : 'border-[#1E293B] bg-[#0B1420] text-slate-300'
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                    {row.provider === 'vpngate' && row.region && (
                      <button
                        disabled={!canWrite || busy !== null}
                        onClick={() => downloadConfig(row.mac)}
                        className="rounded-lg border border-[#1E293B] bg-[#0B1420] px-2.5 py-1 text-[11px] text-[#38BDF8] disabled:opacity-40"
                      >
                        {busy === `shield-config-${row.mac}` ? 'Fetching…' : 'Get connection file'}
                      </button>
                    )}
                  </div>
                )}

                {configFor === row.mac && configResult && (
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {configResult.available
                      ? // No OS-level share sheet on this surface — a wall panel
                        // has nowhere to hand a .ovpn file to. Told plainly
                        // rather than offering a download that goes nowhere
                        // useful.
                        `Config ready via ${configResult.hostname ?? 'the selected server'}. Fetch it from the paired phone to install it — this console has no app to open it with.`
                      : (configResult.error ?? "That server isn't available right now.")}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export const SHIELD_TAB_ICON = ShieldCheck;
