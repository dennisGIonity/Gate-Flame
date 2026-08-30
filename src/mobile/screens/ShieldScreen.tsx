/**
 * Shield — Gate^Flame's per-device VPN, as its own destination.
 *
 * Used to live as the last card at the bottom of Settings (ControlsScreen),
 * with nothing in the tab bar pointing at it. Real and fully working the
 * whole time — Dennis reporting "the app doesn't have the vpn" was a
 * discoverability bug, not a missing feature: nobody scrolls past three
 * other cards looking for a fourth. Same data, same writes, moved to a tab
 * of its own so it reads as a destination rather than an afterthought.
 *
 * Region selection is per LISTED DEVICE, not "this phone": a phone's own
 * real network hardware address is hidden from web/webview code by every
 * current mobile OS for privacy reasons, so the one thing this screen
 * cannot reliably do is ask the handset it's running on for its own MAC.
 * The box already knows every device on the LAN by MAC (clients.py) — the
 * owner picks a device from that list instead, exactly like every other
 * control here changes a HOUSEHOLD setting from any one paired phone, not
 * "this phone only".
 */

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import type {
  VpnContinentsResponse,
  VpnDevicesResponse,
  VpnGateConfigResponse,
  VpnProvider,
  VpnRegionsResponse,
} from '../../types/vpn';
import { kioskApi, usePolled, type LanClient } from '../../components/kiosk/kioskClient';
import { Card, Screen, ScreenTitle } from '../mobileUi';

/**
 * Hand a decoded .ovpn's text to whatever the platform offers, best option
 * first. On the actual phone app (Capacitor native), this writes a temp file
 * and opens the OS share sheet - the owner picks their installed OpenVPN app
 * directly, no hunting through Downloads for a file they don't recognise. In
 * a plain browser (the kiosk console preview, `npm run dev`, or a device
 * where Capacitor's native layer isn't present), Filesystem/Share fall back
 * to their own web implementations; if even those are unavailable this
 * degrades to a plain blob download rather than failing silently - the
 * "never claim success without proving it" habit this repo already keeps
 * elsewhere, applied to a UI affordance instead of a network call.
 */
async function handOffConfigFile(filename: string, configText: string): Promise<'shared' | 'downloaded'> {
  try {
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const written = await Filesystem.writeFile({
      path: filename,
      data: configText,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({
      title: 'Gate^Flame Shield connection file',
      text: 'Open with your OpenVPN app to connect.',
      url: written.uri,
      dialogTitle: 'Open with…',
    });
    return 'shared';
  } catch {
    // Filesystem/Share unavailable or the user dismissed the share sheet
    // without an error worth surfacing - either way, the file itself is
    // real and still worth getting to the owner some way.
    const blob = new Blob([configText], { type: 'application/x-openvpn-profile' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return 'downloaded';
  }
}

interface ClientsResponse {
  clients: LanClient[];
}

interface ShieldRow {
  mac: string;
  /** What to show. The node decides this (device_names.py) so the phone and
   * the wall console can never disagree about what a device is called. */
  label: string;
  /** Shown small under the label, so the MAC is still there when someone
   * needs it without being the thing they have to read. */
  detail: string;
  ownerName: string | null;
  region: string | null;
  enabled: boolean;
  peerRegistered: boolean;
  provider: VpnProvider;
}

/**
 * The second line under a device's name.
 *
 * A named device shows what it actually is underneath - vendor and address -
 * so naming something never hides the identifying detail. An unnamed device
 * shows why it has no better name yet: a randomised MAC genuinely has no
 * vendor to look up, and saying so beats an empty space that reads like a
 * failed lookup.
 */
function detailFor(c: { mac: string; vendor?: string | null; randomisedMac?: boolean; ownerName?: string | null }): string {
  const bits: string[] = [];
  if (c.vendor) bits.push(c.vendor);
  else if (c.randomisedMac) bits.push('private address');
  bits.push(c.mac);
  return bits.join(' · ');
}

export function ShieldScreen({ active }: { active: boolean }) {
  // Regions barely change and this list is not on the household's critical
  // path the way filtering is, so a slower interval than the 6s filtering
  // poll is enough - no reason to wake the box every few seconds for a list
  // that changes when Ionity adds a country, not when anyone touches a
  // toggle. Gated on `active` like every other screen's own polls.
  const regions = usePolled<VpnRegionsResponse>('/vpn/regions', 20000, active);
  const continents = usePolled<VpnContinentsResponse>('/vpn/continents', 20000, active);
  const devices = usePolled<VpnDevicesResponse>('/vpn/devices', 20000, active);
  const clients = usePolled<ClientsResponse>('/clients', 20000, active);

  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showExactFor, setShowExactFor] = useState<string | null>(null);
  const [configFor, setConfigFor] = useState<string | null>(null);
  const [configResult, setConfigResult] = useState<VpnGateConfigResponse | null>(null);
  const [handoff, setHandoff] = useState<'shared' | 'downloaded' | null>(null);

  // Which device is being renamed, and the text so far. Null = nobody.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const r = regions.data;
  const continentList = continents.data?.continents ?? [];
  const knownDevices = devices.data?.devices ?? [];
  const lanList = clients.data?.clients ?? [];

  // A device the box has seen counts even with no Shield row yet - it just
  // reads as "off". A device with a Shield row but no longer on the LAN
  // (a guest who left) still shows, since turning ITS tunnel off is still
  // the owner's to do from here.
  const byMac = new Map(knownDevices.map((d) => [d.mac, d]));
  const rows: ShieldRow[] = [
    ...lanList.map((c) => ({
      mac: c.mac,
      // `label` is computed on the node. Falling back through hostname to the
      // MAC keeps this working against an older agent that predates it.
      label: c.label || c.hostname || c.mac,
      detail: detailFor(c),
      ownerName: c.ownerName ?? null,
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
        // Shield knows this device but the box cannot see it on the LAN right
        // now — a guest who left, or a phone that is off. Said plainly,
        // because its tunnel can still be switched off from here.
        detail: 'not on the network right now',
        ownerName: null,
        region: d.region,
        enabled: d.enabled,
        peerRegistered: d.peerRegistered,
        provider: d.provider ?? 'headscale',
      })),
  ];

  async function saveName(mac: string) {
    setBusy(`name-${mac}`);
    setProblem(null);
    try {
      await kioskApi.setClientName(mac, draftName);
      clients.refresh();
      setRenaming(null);
      setDraftName('');
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That name did not save.');
    } finally {
      setBusy(null);
    }
  }

  async function setDevice(mac: string, region: string | null, enabled: boolean, provider: VpnProvider) {
    setBusy(`shield-${mac}`);
    setProblem(null);
    setConfigFor(null);
    try {
      const result = await kioskApi.setVpnDevice(mac, region, enabled, provider);
      if (result.lastError) setProblem(result.lastError);
      devices.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  // vpngate-only: fetch the live .ovpn text and hand it off (share sheet on
  // native, download fallback otherwise). Fetched fresh on demand rather than
  // kept in state from any earlier poll, since VPN Gate's own server list
  // rotates - a config more than a few minutes old could already point at a
  // server that's gone.
  async function downloadConfig(mac: string) {
    setBusy(`shield-config-${mac}`);
    setConfigResult(null);
    setHandoff(null);
    try {
      const result = await kioskApi.getVpnGateConfig(mac);
      setConfigResult(result);
      setConfigFor(mac);
      if (result.available && result.configText) {
        const filename = `gateflame-shield-${(result.countryCode ?? 'region').toLowerCase()}.ovpn`;
        setHandoff(await handOffConfigFile(filename, result.configText));
      }
    } catch (err) {
      setConfigResult({ available: false, error: err instanceof Error ? err.message : 'That did not go through.' });
      setConfigFor(mac);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <ScreenTitle
        kicker="07 · Shield"
        title={r?.label ?? 'Gate^Flame Shield'}
        sub="Per-device VPN. Pick a device the box has seen, then a region."
      />

      {problem && (
        <Card accent="fault">
          <p className="text-sm text-[#E11D48]">{problem}</p>
        </Card>
      )}

      <Card>
        <div className="mb-1 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#38BDF8]" />
          <p className="text-sm font-semibold text-slate-100">{r?.label ?? 'Gate^Flame Shield'}</p>
        </div>

        {!r || r.regions.length === 0 ? (
          <p className="text-xs leading-relaxed text-[#64748B]">
            {!r || (!r.controlPlaneReachable && !r.vpnGateAvailable)
              ? 'Not set up on this box yet. Nothing to turn on until it is.'
              : 'Set up, but no regions are available right now.'}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs leading-relaxed text-[#64748B]">
            {clients.data ? 'No devices seen on your network yet.' : 'Reading your devices…'}
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <div key={row.mac} className="rounded-xl border border-[#1E293B] bg-[#0F1B2D] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {renaming === row.mac ? (
                      /* Renaming replaces the label in place rather than
                         opening a dialog: on a phone a modal for one short
                         field is more ceremony than the edit is worth. */
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={draftName}
                          maxLength={48}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveName(row.mac);
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          placeholder="e.g. Kyle's tablet"
                          className="min-w-0 flex-1 rounded-lg border border-[#38BDF8]/60 bg-[#0B1420] px-2.5 py-1.5 text-sm text-slate-100 outline-none placeholder:text-[#475569]"
                        />
                        <button
                          disabled={busy !== null}
                          onClick={() => void saveName(row.mac)}
                          className="shrink-0 rounded-lg bg-[#38BDF8] px-2.5 py-1.5 text-[11px] font-semibold text-[#081018] disabled:opacity-60"
                        >
                          {busy === `name-${row.mac}` ? '…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setRenaming(null)}
                          className="shrink-0 rounded-lg border border-[#1E293B] px-2.5 py-1.5 text-[11px] text-[#64748B]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setRenaming(row.mac);
                          // Seed with the existing name only. Pre-filling a
                          // vendor guess would turn "Apple 1CCB" into a name
                          // the owner never chose the moment they hit save.
                          setDraftName(row.ownerName ?? '');
                        }}
                        className="block w-full text-left"
                      >
                        <span className="block truncate text-sm text-slate-200">{row.label}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-[#475569]">
                          {row.detail}
                          <span className="ml-1.5 text-[#38BDF8]">rename</span>
                        </span>
                      </button>
                    )}
                  </div>
                  <button
                    disabled={busy !== null}
                    onClick={() => {
                      const fallback = r.regions[0];
                      setDevice(
                        row.mac,
                        row.region ?? fallback?.code ?? null,
                        !row.enabled,
                        row.region ? row.provider : (fallback?.provider ?? 'headscale'),
                      );
                    }}
                    className={`relative mt-1 h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
                      row.enabled ? 'bg-[#38BDF8]' : 'bg-[#334155]'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                        row.enabled ? 'left-[1.125rem]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
                {row.enabled && (
                  <>
                    {/* Ionity's own regions (headscale), once any exist - a small,
                        curated set with no continent concept, so always shown
                        directly rather than behind the "exact country" toggle
                        below, which exists only to keep VPN Gate's much longer
                        country list from cluttering this row by default. */}
                    {r.regions.some((reg) => reg.provider === 'headscale') && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.regions
                          .filter((reg) => reg.provider === 'headscale')
                          .map((reg) => (
                            <RegionChip
                              key={`${reg.provider}-${reg.code}`}
                              label={reg.label}
                              active={reg.code === row.region && reg.provider === row.provider}
                              available={reg.available}
                              disabled={busy !== null}
                              onClick={() => setDevice(row.mac, reg.code, true, reg.provider)}
                            />
                          ))}
                      </div>
                    )}

                    {/* VPN Gate, grouped by continent - picking "Europe" beats
                        picking one of fifteen European countries. Tapping a
                        continent resolves straight to its current best
                        country; nothing downstream needs to know continents
                        exist. */}
                    {continentList.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {continentList.map((c) => (
                          <RegionChip
                            key={c.code}
                            label={c.label}
                            active={row.provider === 'vpngate' && row.region === c.bestCountryCode}
                            available={c.available}
                            disabled={busy !== null}
                            onClick={() => setDevice(row.mac, c.bestCountryCode, true, 'vpngate')}
                          />
                        ))}
                      </div>
                    )}

                    {continentList.length > 0 && (
                      <button
                        disabled={busy !== null}
                        onClick={() => setShowExactFor(showExactFor === row.mac ? null : row.mac)}
                        className="mt-2 text-[11px] text-[#64748B] underline decoration-dotted disabled:opacity-40"
                      >
                        {showExactFor === row.mac ? 'Hide exact countries' : 'Choose an exact country instead'}
                      </button>
                    )}

                    {(showExactFor === row.mac || continentList.length === 0) && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.regions
                          .filter((reg) => reg.provider === 'vpngate')
                          .map((reg) => (
                            <RegionChip
                              key={`${reg.provider}-${reg.code}`}
                              label={reg.label}
                              active={reg.code === row.region && reg.provider === row.provider}
                              available={reg.available}
                              disabled={busy !== null}
                              onClick={() => setDevice(row.mac, reg.code, true, reg.provider)}
                              community
                            />
                          ))}
                      </div>
                    )}

                    {row.provider === 'vpngate' && row.region && (
                      <div className="mt-2">
                        <button
                          disabled={busy !== null}
                          onClick={() => downloadConfig(row.mac)}
                          className="rounded-lg border border-[#1E293B] bg-[#0B1420] px-2.5 py-1 text-[11px] text-[#38BDF8] disabled:opacity-40"
                        >
                          {busy === `shield-config-${row.mac}` ? 'Fetching…' : 'Get connection file'}
                        </button>
                        {configFor === row.mac && configResult && (
                          <p className="mt-1 text-[11px] leading-relaxed text-[#64748B]">
                            {configResult.available
                              ? handoff === 'shared'
                                ? `Pick your OpenVPN app from the share sheet to connect via ${configResult.hostname ?? 'the selected server'}.`
                                : `Saved. Open it with your phone's OpenVPN app to connect via ${configResult.hostname ?? 'the selected server'}.`
                              : (configResult.error ?? "That server isn't available right now.")}
                          </p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </Screen>
  );
}

function RegionChip({
  label,
  active,
  available,
  disabled,
  onClick,
  community = false,
}: {
  label: string;
  active: boolean;
  available: boolean;
  disabled: boolean;
  onClick: () => void;
  /** Small, honest "not audited infrastructure" tag - see vpngate.py's own
   * docstring for why this is never omitted for a VPN Gate entry. */
  community?: boolean;
}) {
  return (
    <button
      disabled={disabled || !available}
      onClick={onClick}
      className={`rounded-lg border px-2.5 py-1 text-[11px] disabled:opacity-40 ${
        active
          ? 'border-[#38BDF8]/60 bg-[#38BDF8]/10 text-[#38BDF8]'
          : 'border-[#1E293B] bg-[#0B1420] text-slate-300'
      }`}
    >
      {label}
      {community && <span className="text-[#64748B]"> · community</span>}
      {!available && ' (offline)'}
    </button>
  );
}
