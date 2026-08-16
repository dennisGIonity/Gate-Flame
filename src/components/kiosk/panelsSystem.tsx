/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: system panels
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

import { useState } from 'react';

import {
  DASH,
  bytes,
  clockTime,
  duration,
  kioskApi,
  num,
  pct,
  useSeries,
  usePolled,
  type BouncedEntry,
  type PairedDevice,
  type PostureAudit,
  type ServiceModule,
  type SystemStatus,
  type KioskMount,
  type WanSummary,
} from './kioskClient';
import {
  ActionButton,
  COLORS,
  Card,
  EmptyState,
  GapNote,
  Gauge,
  HoldButton,
  SinceNote,
  Sparkline,
  StatTile,
  StatusPill,
  Toggle,
  ViewerNotice,
} from './kioskUi';
import type { PanelContext } from './panels';

// ===========================================================================
// Modules
// ===========================================================================

export function ModulesPanel({ active, authority }: PanelContext) {
  const services = usePolled<{ modules: ServiceModule[] }>('/services', 5000, active);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modules = services.data?.modules ?? [];
  const running = useSeries(services.data ? modules.filter((m) => m.status === 'running').length : undefined);
  const canWrite = authority === 'console';

  const toggle = async (m: ServiceModule, enable: boolean) => {
    setBusy(m.id);
    setError(null);
    try {
      await (enable ? kioskApi.startModule(m.id) : kioskApi.stopModule(m.id));
      services.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The node refused that change.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 grid grid-cols-4 gap-6">
        <StatTile label="Modules" value={num(modules.length)} />
        <StatTile
          label="Running"
          value={num(modules.filter((m) => m.status === 'running').length)}
          tone="good"
          series={running.samples}
        />
        <StatTile
          label="Degraded"
          value={num(modules.filter((m) => m.status === 'degraded').length)}
          tone={modules.some((m) => m.status === 'degraded') ? 'warn' : 'default'}
        />
        <StatTile
          label="Not built"
          value={num(modules.filter((m) => m.status === 'not_implemented' || m.status === 'stopped').length)}
        />
      </div>

      {error && (
        <div className="col-span-12 rounded-xl border border-[#E11D48]/50 bg-[#E11D48]/10 px-5 py-4 text-sm text-[#E11D48]">
          {error}
        </div>
      )}

      <Card
        className="col-span-12"
        title="Capability registry"
        subtitle="Every module states what it is doing, or names exactly what it needs. A module carrying a gap never shows green."
      >
        {!canWrite && <ViewerNotice what="Starting and stopping modules" />}
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {modules.length === 0 && <EmptyState title="No modules reported" detail="The agent answered with an empty registry." />}
          {modules.map((m) => (
            <div key={m.id} className="rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-100">{m.label}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-slate-600">{m.id}</p>
                </div>
                <StatusPill status={m.status} hasGap={Boolean(m.gap)} />
              </div>
              <GapNote text={m.gap} />
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider text-slate-600">
                  {m.status === 'not_implemented' ? 'no switch — not built' : m.status === 'running' ? 'on' : 'off'}
                </span>
                <Toggle
                  label={m.label}
                  checked={m.status === 'running'}
                  disabled={!canWrite || busy === m.id || m.status === 'not_implemented'}
                  onChange={(next) => void toggle(m, next)}
                />
              </div>
            </div>
          ))}
        </div>
        {/*
          The asymmetry is the node's, not this screen's: starting is `control`
          scope so a paired phone can restore protection remotely, stopping is
          `kiosk` scope so a stolen phone cannot switch the product off. See
          docs/PAIRING-AND-TELEMETRY.md §3.2.
        */}
        <p className="mt-5 text-sm text-slate-500">
          Starting a module can be done from a paired phone. Stopping one requires this console — switching
          protection off persists across reboots, so it takes physical presence.
        </p>
        <SinceNote since={running.since} />
      </Card>
    </div>
  );
}

// ===========================================================================
// Firewall
// ===========================================================================

export function FirewallPanel({ active, authority }: PanelContext) {
  const bounced = usePolled<{ bounced: BouncedEntry[] }>('/firewall/bounced', 6000, active);
  const [error, setError] = useState<string | null>(null);
  const list = bounced.data?.bounced ?? [];
  const canWrite = authority === 'console';

  const release = async (address: string) => {
    setError(null);
    try {
      await kioskApi.releaseBounce(address);
      bounced.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The node refused to release that address.');
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 grid grid-cols-3 gap-6">
        <StatTile label="Addresses bounced" value={num(list.length)} tone={list.length ? 'warn' : 'default'} />
        <StatTile label="Enforcement" value={bounced.error ? DASH : 'nftables'} gap={bounced.error?.message} />
        <StatTile label="Read from" value="kernel" />
      </div>

      {error && (
        <div className="col-span-12 rounded-xl border border-[#E11D48]/50 bg-[#E11D48]/10 px-5 py-4 text-sm text-[#E11D48]">
          {error}
        </div>
      )}

      <Card
        className="col-span-12"
        title="Bounced addresses"
        subtitle="Read straight out of the kernel set on every poll — elements expire there, so a cached copy would start lying the moment a timeout fired."
      >
        {!canWrite && <ViewerNotice what="Releasing a bounced address" />}
        {list.length === 0 ? (
          <EmptyState
            title="Nothing is bounced"
            detail="No address is currently held in the nftables set. If the module reports a capability gap on the Modules tab, that gap is the reason — not an absence of threats."
          />
        ) : (
          <div className="space-y-3">
            {list.map((b, i) => {
              const address = String(b.address ?? b.elem ?? DASH);
              return (
                <div
                  key={`${address}-${i}`}
                  className="flex items-center justify-between rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 px-5 py-4"
                >
                  <div>
                    <p className="font-mono text-lg text-slate-100">{address}</p>
                    <p className="text-xs uppercase tracking-wider text-slate-600">
                      expires {b.expires ? clockTime(b.expires as number) : DASH}
                    </p>
                  </div>
                  <HoldButton
                    label="Hold to release"
                    tone="danger"
                    disabled={!canWrite}
                    onConfirm={() => void release(address)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// WAN
// ===========================================================================

export function WanPanel({ active }: PanelContext) {
  const wan = usePolled<WanSummary>('/wan/summary', 15000, active);
  const interfaces = Object.values(wan.data?.interfaces ?? {});

  return (
    <div className="grid grid-cols-12 gap-6">
      {wan.data?.gap && (
        <Card className="col-span-12" accent="warn" title="WAN metering unavailable">
          <GapNote text={wan.data.gap} />
          <p className="mt-3 text-sm text-slate-500">
            Set <span className="font-mono text-slate-400">GATEFLAME_WAN_INTERFACES</span> on the node to start
            metering. Until then no usage figure exists — which is not the same as zero usage.
          </p>
        </Card>
      )}

      {interfaces.length === 0 && !wan.data?.gap && (
        <div className="col-span-12">
          <EmptyState title="No interfaces configured" detail="The agent reported an empty interface map." />
        </div>
      )}

      {interfaces.map((b) => (
        <Card key={b.iface} className="col-span-6" title={b.iface} subtitle={`Billing month ${b.month}`}>
          <div className="flex items-center gap-8">
            <Gauge value={b.percentOfCap} label="of cap" tone={(b.percentOfCap ?? 0) > 85 ? COLORS.fault : COLORS.blue} />
            <div className="grid flex-1 grid-cols-2 gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Used</p>
                <p className="font-mono text-2xl tabular-nums text-slate-100">{bytes(b.usedBytes)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Cap</p>
                <p className="font-mono text-2xl tabular-nums text-slate-100">{bytes(b.capBytes)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Down / Up</p>
                <p className="font-mono text-base tabular-nums text-slate-300">
                  {bytes(b.rxBytes)} / {bytes(b.txBytes)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Projected month</p>
                <p className="font-mono text-base tabular-nums text-slate-300">{bytes(b.projectedTotalBytes)}</p>
              </div>
            </div>
          </div>
          <GapNote text={b.gap} />
        </Card>
      ))}

      {wan.data?.link && (
        <Card className="col-span-12" title="Link quality">
          <div className="grid grid-cols-4 gap-6">
            {Object.entries(wan.data.link)
              .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
              .map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{k.replace(/([A-Z])/g, ' $1')}</p>
                  <p className="mt-1 font-mono text-2xl tabular-nums text-slate-100">
                    {v === null ? DASH : String(v)}
                  </p>
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ===========================================================================
// System — the appliance about itself
// ===========================================================================

const SEVERITY_TONE: Record<string, string> = {
  critical: 'text-[#E11D48] border-[#E11D48]/40',
  high: 'text-[#E11D48] border-[#E11D48]/40',
  medium: 'text-[#F59E0B] border-[#F59E0B]/40',
  low: 'text-[#38BDF8] border-[#38BDF8]/30',
};

export function SystemPanel({ telemetry, active, authority }: PanelContext & { status: SystemStatus | null }) {
  const posture = usePolled<PostureAudit>('/posture/audit', 30000, active);
  const devices = usePolled<{ devices: PairedDevice[] }>('/pair/devices', 10000, active);
  const kioskMount = usePolled<KioskMount>('/system/kiosk', 60000, active);
  const [error, setError] = useState<string | null>(null);

  const host = telemetry?.host;
  const mem = useSeries(host?.memUsedMB);
  const disk = useSeries(host?.diskUsedPercent);
  const canWrite = authority === 'console';
  // `0x0` is the healthy value. Anything else is the SoC reporting an
  // undervoltage or thermal event, which on a Pi is usually the power supply.
  const throttled = host?.throttleFlags !== null && host?.throttleFlags !== undefined && host.throttleFlags !== '0x0';

  const revoke = async (id: string) => {
    setError(null);
    try {
      await kioskApi.revokeDevice(id);
      devices.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The node refused that revocation.');
    }
  };

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 grid grid-cols-4 gap-6">
        <StatTile label="CPU" value={pct(host?.cpuPercent)} />
        <StatTile
          label="Temperature"
          value={host?.tempC === null || host?.tempC === undefined ? DASH : `${host.tempC.toFixed(1)}°C`}
          tone={(host?.tempC ?? 0) >= 80 ? 'fault' : (host?.tempC ?? 0) >= 70 ? 'warn' : 'default'}
        />
        <StatTile
          label="Throttle flags"
          value={host?.throttleFlags ?? DASH}
          tone={throttled ? 'fault' : 'good'}
          gap={throttled ? 'Non-zero flags mean the SoC has throttled — check the power supply and cooling.' : null}
        />
        <StatTile label="Agent uptime" value={duration(telemetry?.uptimeSeconds)} />
      </div>

      <Card className="col-span-6" title="Memory and storage">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Memory used</p>
            <p className="mt-1 font-mono text-3xl tabular-nums text-slate-100">
              {num(host?.memUsedMB)}
              <span className="text-lg text-slate-500"> / {num(host?.memTotalMB)} MB</span>
            </p>
            <Sparkline samples={mem.samples} height={44} stroke={COLORS.cyan} className="mt-2" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Disk used</p>
            <p className="mt-1 font-mono text-3xl tabular-nums text-slate-100">{pct(host?.diskUsedPercent)}</p>
            <Sparkline samples={disk.samples} height={44} max={100} stroke={COLORS.orange} className="mt-2" />
          </div>
        </div>
        <SinceNote since={mem.since} />
      </Card>

      <Card
        className="col-span-6"
        title="Paired devices"
        subtitle="Phones holding a token for this node."
        right={
          devices.data?.devices.length ? (
            <HoldButton
              label="Hold to revoke all"
              tone="danger"
              disabled={!canWrite}
              onConfirm={() => void kioskApi.revokeAll().then(devices.refresh)}
            />
          ) : null
        }
      >
        {!canWrite && <ViewerNotice what="Revoking a paired device" />}
        {error && <p className="mb-3 text-sm text-[#E11D48]">{error}</p>}
        {devices.data?.devices.length ? (
          <div className="space-y-2">
            {devices.data.devices.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 px-4 py-3"
              >
                <div>
                  <p className="text-base text-slate-100">{d.deviceName ?? 'Unnamed device'}</p>
                  <p className="font-mono text-xs text-slate-600">
                    {d.id} · last seen {clockTime(d.lastSeenAt)}
                  </p>
                </div>
                <HoldButton label="Hold to revoke" tone="danger" disabled={!canWrite} onConfirm={() => void revoke(d.id)} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No phones paired"
            detail="Use “Pair a phone” in the header. Revoking every device never un-provisions the node — a lost phone must not re-arm first-boot admin."
          />
        )}
      </Card>

      <Card
        className="col-span-7"
        title="Zero-trust posture"
        subtitle="Read-only findings about this appliance. Nothing here remediates anything."
      >
        {posture.data?.gap && <GapNote text={posture.data.gap} />}
        {posture.data?.findings?.length ? (
          <div className="space-y-3">
            {posture.data.findings.map((f) => (
              <div key={f.id} className={`rounded-xl border bg-[#0F1B2D]/60 p-4 ${SEVERITY_TONE[f.severity] ?? 'border-[#1E293B] text-slate-300'}`}>
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-base font-semibold">{f.title}</p>
                  <span className="text-xs font-semibold uppercase tracking-wider">{f.severity}</span>
                </div>
                <p className="mt-1 text-sm text-slate-400">{f.observed}</p>
                <p className="mt-1 text-sm text-slate-500">Remedy: {f.remedy}</p>
              </div>
            ))}
          </div>
        ) : (
          !posture.data?.gap && <EmptyState title="No posture findings" detail="Every completed check passed." />
        )}
        {posture.data?.gaps?.length ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Checks that could not run</p>
            {posture.data.gaps.map((g) => (
              <p key={g.id} className="text-sm text-[#F59E0B]">
                {g.id} — {g.reason}
              </p>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="col-span-5" title="This display">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Served from</dt>
            <dd className="font-mono text-slate-200">{kioskMount.data?.path ?? DASH}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Bundle directory</dt>
            <dd className="truncate font-mono text-slate-300">{kioskMount.data?.directory ?? DASH}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Authority</dt>
            <dd className="font-mono text-slate-200">{authority === 'console' ? 'kiosk (loopback)' : 'read-only'}</dd>
          </div>
        </dl>
        <GapNote text={kioskMount.data?.gap} />
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          Nothing on this screen is load-bearing. The agent filters, meters and enforces whether or not a display
          is attached — unplug it and the network stays protected.
        </p>
      </Card>
    </div>
  );
}
