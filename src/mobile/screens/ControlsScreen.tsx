/**
 * Controls — the small number of things a customer may change.
 *
 * DELIBERATELY SMALL. This is a plug-and-play product and every control is a
 * support call waiting to happen, so the phone gets the three that a household
 * genuinely needs and nothing else:
 *
 *   how much danger to block      threat level, three steps
 *   what content to block         categories, all off by default
 *   turn it off for a bit         pause, with an expiry
 *
 * Everything destructive stays at the box. Stopping a module, revoking a
 * device and issuing a pairing code all need `kiosk` scope, which the node
 * grants from a loopback socket and never from a token — so those controls are
 * ABSENT here, not disabled. A disabled button is still a question.
 *
 * Writes go through the same client the console uses, so the two surfaces
 * cannot drift about what a setting means.
 */

import { useState } from 'react';
import { Check, Loader2, ShieldCheck } from 'lucide-react';

import type { FilteringState, PauseDurationId, ThreatLevelId } from '../../types/filtering';
import type {
  VpnContinentsResponse,
  VpnDevicesResponse,
  VpnGateConfigResponse,
  VpnProvider,
  VpnRegionsResponse,
} from '../../types/vpn';
import { kioskApi, num, usePolled, type LanClient, type Polled } from '../../components/kiosk/kioskClient';
import { CH, Meter } from '../../components/kiosk/charts';
import { Card, Chip, Gap, Screen, ScreenTitle, Warning } from '../mobileUi';

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

export function ControlsScreen({ filtering }: { filtering: Polled<FilteringState> }) {
  const f = filtering.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // Gate^Flame Shield (per-device VPN). Regions barely change and this list
  // is not on the household's critical path the way filtering is, so a
  // slower interval than the 6s filtering poll is enough - no reason to
  // wake the box every few seconds for a list that changes when Ionity adds
  // a country, not when anyone touches a toggle.
  const shieldRegions = usePolled<VpnRegionsResponse>('/vpn/regions', 20000);
  const shieldContinents = usePolled<VpnContinentsResponse>('/vpn/continents', 20000);
  const shieldDevices = usePolled<VpnDevicesResponse>('/vpn/devices', 20000);
  const lanClients = usePolled<ClientsResponse>('/clients', 20000);

  /**
   * Run a write, then refresh from the node rather than trusting our own
   * optimistic guess. The node is the only thing that knows whether a change
   * actually landed — tonight proved that a write can be accepted and still not
   * take effect.
   */
  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setProblem(null);
    try {
      await fn();
      filtering.refresh();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not go through.');
    } finally {
      setBusy(null);
    }
  }

  if (!f) {
    return (
      <Screen>
        <ScreenTitle title="Settings" />
        <Card>
          <p className="text-sm text-[#64748B]">
            {filtering.error
              ? 'I cannot reach your box, so I will not show settings that might be out of date.'
              : 'Reading your settings from the box…'}
          </p>
        </Card>
      </Screen>
    );
  }

  const paused = f.protectionStatus === 'paused';

  return (
    <Screen>
      <ScreenTitle
        kicker="06 · Controls"
        title="Settings"
        sub="The few things worth changing from your phone."
        right={
          <Chip tone={paused ? 'warn' : f.enabled ? 'good' : 'fault'}>
            {paused ? 'paused' : f.enabled ? 'on' : 'off'}
          </Chip>
        }
      />

      {/* ------------------------------------------------ what is set now
          Controls with no readout are unverified claims. These three bars are
          the current configuration stated as quantities, so a customer can see
          at a glance that a choice actually took — which is exactly what was
          missing when a box ran for days with an empty blocklist while every
          control on every screen looked correctly set.                     */}
      <Card>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#64748B]">
          What is set right now
        </p>
        <div className="space-y-3.5">
          <Meter
            label="How much is blocked"
            value={
              f.availableLevels.findIndex((l) => l.level === f.threatLevel.level) < 0
                ? null
                : f.availableLevels.findIndex((l) => l.level === f.threatLevel.level) + 1
            }
            max={Math.max(1, f.availableLevels.length)}
            format={() => f.threatLevel.level.toUpperCase()}
            tone={CH.green}
          />
          <Meter
            label="Threat lists in use"
            value={f.threatLevel.blocklistCount ?? null}
            max={Math.max(1, ...f.availableLevels.map((l) => l.blocklistCount ?? 0))}
            format={(v) => num(v)}
            tone={CH.cyan}
          />
          <Meter
            label="Content categories on"
            value={f.categories.filter((c) => c.enabled).length}
            max={Math.max(1, f.categories.length)}
            format={(v) => `${v ?? 0} of ${f.categories.length}`}
            tone={CH.blue}
          />
        </div>
        {/* The node's own words about the last write that did not land. */}
        <Gap text={f.lastError} />
      </Card>

      {problem && <Warning tone="fault" title="That did not go through" detail={problem} />}
      {f.applying && (
        <Card accent="warn">
          <p className="flex items-center gap-2 text-sm text-[#F59E0B]">
            <Loader2 className="h-4 w-4 animate-spin" /> Updating the blocklist…
          </p>
        </Card>
      )}

      {/* ------------------------------------------------- threat level */}
      <Card>
        <p className="mb-1 text-sm font-semibold text-slate-100">How much to block</p>
        <p className="mb-3 text-xs leading-relaxed text-[#64748B]">
          Higher settings block more, and are slightly more likely to catch something you wanted.
        </p>
        <div className="flex flex-col gap-2">
          {f.availableLevels.map((lvl) => {
            const on = lvl.level === f.threatLevel.level;
            return (
              <button
                key={lvl.level}
                disabled={busy !== null}
                onClick={() => run(`lvl-${lvl.level}`, () => kioskApi.setThreatLevel(lvl.level as ThreatLevelId))}
                className={`flex min-h-[56px] items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 ${
                  on ? 'border-[#38BDF8]/60 bg-[#38BDF8]/10' : 'border-[#1E293B] bg-[#0F1B2D]'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                    on ? 'border-[#38BDF8] bg-[#38BDF8]' : 'border-[#334155]'
                  }`}
                >
                  {on && <Check className="h-3 w-3 text-[#081018]" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-medium capitalize ${on ? 'text-[#38BDF8]' : 'text-slate-200'}`}>
                    {lvl.level}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-[#64748B]">
                    {lvl.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* ---------------------------------------------------- categories */}
      <Card>
        <p className="mb-1 text-sm font-semibold text-slate-100">Block whole categories</p>
        <p className="mb-3 text-xs leading-relaxed text-[#64748B]">
          All off unless you turn them on.
        </p>
        <div className="flex flex-col gap-2">
          {f.categories.map((cat) => (
            <button
              key={cat.id}
              disabled={busy !== null}
              onClick={() =>
                run(`cat-${cat.id}`, () =>
                  kioskApi.setCategories(
                    cat.enabled
                      ? f.categories.filter((c) => c.enabled && c.id !== cat.id).map((c) => c.id)
                      : [...f.categories.filter((c) => c.enabled).map((c) => c.id), cat.id],
                  ),
                )
              }
              className="flex min-h-[56px] items-center gap-3 rounded-xl border border-[#1E293B] bg-[#0F1B2D] px-3 py-3 text-left disabled:opacity-60"
            >
              <span
                className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${
                  cat.enabled ? 'bg-[#38BDF8]' : 'bg-[#334155]'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                    cat.enabled ? 'left-[1.125rem]' : 'left-0.5'
                  }`}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-slate-200">{cat.label}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-[#64748B]">
                  {cat.description}
                </span>
                {/* Shown BEFORE the toggle is used, not after it breaks something. */}
                {cat.caution && (
                  <span className="mt-1 block text-[11px] leading-relaxed text-[#F59E0B]">
                    {cat.caution}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* --------------------------------------------------------- pause */}
      <Card accent={paused ? 'warn' : 'none'}>
        <p className="mb-1 text-sm font-semibold text-slate-100">
          {paused ? 'Protection is off' : 'Turn protection off for a while'}
        </p>
        {paused ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-[#64748B]">
              {f.durationLabel ? `Set to resume: ${f.durationLabel}.` : 'It will stay off until you turn it back on.'}
              {f.reason ? ` Reason given: ${f.reason}` : ''}
            </p>
            <button
              disabled={busy !== null}
              onClick={() => run('resume', () => kioskApi.resumeFiltering())}
              className="min-h-[48px] w-full rounded-xl bg-[#10B981] px-4 text-sm font-semibold text-[#04160F] disabled:opacity-60"
            >
              Turn protection back on
            </button>
          </>
        ) : (
          <>
            <p className="mb-3 text-xs leading-relaxed text-[#64748B]">
              Nothing will be blocked until it comes back on.
            </p>
            <div className="flex flex-wrap gap-2">
              {/* The two open-ended durations need a deliberate confirmation at
                  the box, so the phone only offers the ones that expire. A pause
                  that never ends is how a household ends up unprotected for
                  months without noticing. */}
              {f.pauseDurations
                .filter((d) => !d.requiresConfirmation)
                .map((d) => (
                  <button
                    key={d.id}
                    disabled={busy !== null}
                    onClick={() => run(`pause-${d.id}`, () => kioskApi.pauseFiltering(d.id as PauseDurationId))}
                    className="min-h-[48px] flex-1 rounded-xl border border-[#1E293B] bg-[#0F1B2D] px-3 text-sm text-slate-200 disabled:opacity-60"
                  >
                    {d.label}
                  </button>
                ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#64748B]">
              Longer pauses can only be set at the box itself.
            </p>
          </>
        )}
      </Card>

      {/* --------------------------------------------------------- shield
          Gate^Flame Shield - per-device VPN. Region selection is per LISTED
          DEVICE, not "this phone": a phone's own real network hardware
          address is hidden from web/webview code by every current mobile
          OS for privacy reasons, so the one thing this screen cannot
          reliably do is ask the handset it's running on for its own MAC.
          The box already knows every device on the LAN by MAC
          (clients.py) - the owner picks a device from that list instead,
          exactly like every other control here changes a HOUSEHOLD
          setting from any one paired phone, not "this phone only". */}
      <ShieldCard
        regions={shieldRegions}
        continents={shieldContinents}
        devices={shieldDevices}
        clients={lanClients}
        busy={busy}
        setBusy={setBusy}
        setProblem={setProblem}
      />

      <Gap text={f.lastError} />
    </Screen>
  );
}

interface ShieldRow {
  mac: string;
  label: string;
  region: string | null;
  enabled: boolean;
  peerRegistered: boolean;
  provider: VpnProvider;
}

function ShieldCard({
  regions,
  continents,
  devices,
  clients,
  busy,
  setBusy,
  setProblem,
}: {
  regions: Polled<VpnRegionsResponse>;
  continents: Polled<VpnContinentsResponse>;
  devices: Polled<VpnDevicesResponse>;
  clients: Polled<ClientsResponse>;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setProblem: (v: string | null) => void;
}) {
  const r = regions.data;
  const continentList = continents.data?.continents ?? [];
  const knownDevices = devices.data?.devices ?? [];
  const lanList = clients.data?.clients ?? [];
  const [showExactFor, setShowExactFor] = useState<string | null>(null);

  // A device the box has seen counts even with no Shield row yet - it just
  // reads as "off". A device with a Shield row but no longer on the LAN
  // (a guest who left) still shows, since turning ITS tunnel off is still
  // the owner's to do from here.
  const byMac = new Map(knownDevices.map((d) => [d.mac, d]));
  const rows: ShieldRow[] = [
    ...lanList.map((c) => ({
      mac: c.mac,
      label: c.hostname || c.mac,
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

  const [configFor, setConfigFor] = useState<string | null>(null);
  const [configResult, setConfigResult] = useState<VpnGateConfigResponse | null>(null);

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
  const [handoff, setHandoff] = useState<'shared' | 'downloaded' | null>(null);

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
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-[#38BDF8]" />
        <p className="text-sm font-semibold text-slate-100">
          {r?.label ?? 'Gate^Flame Shield'}
        </p>
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
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm text-slate-200">{row.label}</span>
                <button
                  disabled={busy !== null}
                  onClick={() => {
                    const fallback = r.regions[0];
                    setDevice(
                      row.mac,
                      row.region ?? fallback?.code ?? null,
                      !row.enabled,
                      row.region ? row.provider : fallback?.provider ?? 'headscale',
                    );
                  }}
                  className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
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

                  {/* VPN Gate, grouped by continent - Dennis's own ask: picking
                      "Europe" beats picking one of fifteen European countries.
                      Tapping a continent resolves straight to its current best
                      country; nothing downstream needs to know continents exist. */}
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
                            : configResult.error ?? "That server isn't available right now."}
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
