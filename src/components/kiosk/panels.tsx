/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: primary panels
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

import { useMemo, useState } from 'react';
import { ShieldCheck, ShieldOff, ShieldAlert } from 'lucide-react';

import type { FilteringState, PauseDurationId, ThreatLevelId } from '../../types/filtering';
import {
  DASH,
  clockTime,
  duration,
  num,
  pct,
  useSeries,
  usePolled,
  type ConsoleAuthority,
  type FlowsResponse,
  type LanClient,
  type TelemetrySummary,
  type ThreatsResponse,
} from './kioskClient';
import {
  ActionButton,
  COLORS,
  Card,
  EmptyState,
  GapNote,
  Gauge,
  HoldButton,
  ProportionBar,
  SegmentedControl,
  SinceNote,
  Sparkline,
  StatTile,
  Toggle,
  ViewerNotice,
} from './kioskUi';

export interface PanelContext {
  telemetry: TelemetrySummary | null;
  filtering: FilteringState | null;
  authority: ConsoleAuthority;
  active: boolean;
}

// ===========================================================================
// Overview
// ===========================================================================

const PROTECTION_COPY: Record<string, { icon: typeof ShieldCheck; title: string; tone: string }> = {
  active: { icon: ShieldCheck, title: 'Network filtered', tone: 'text-[#10B981]' },
  paused: { icon: ShieldOff, title: 'Filtering paused by you', tone: 'text-[#F59E0B]' },
  bypass: { icon: ShieldAlert, title: 'Unprotected — the box fell back', tone: 'text-[#E11D48]' },
};

export function OverviewPanel({ telemetry, filtering, active }: PanelContext) {
  const clients = usePolled<{ clients: LanClient[] }>('/clients', 8000, active);

  const queries = useSeries(telemetry?.totalQueriesToday);
  const blocked = useSeries(telemetry?.queriesBlockedToday);
  const cpu = useSeries(telemetry?.host?.cpuPercent);
  const temp = useSeries(telemetry?.host?.tempC);

  const status = filtering?.protectionStatus ?? null;
  const face = status ? PROTECTION_COPY[status] : null;
  const Icon = face?.icon ?? ShieldCheck;

  // Devices: prefer the number the agent reports, fall back to the length of
  // the list it just sent. Both are measurements; neither is invented. If both
  // are absent this stays null and renders as an em-dash.
  const deviceCount = telemetry?.activeClientsCount ?? clients.data?.clients.length ?? null;

  const allowed =
    telemetry?.totalQueriesToday !== null &&
    telemetry?.totalQueriesToday !== undefined &&
    telemetry?.queriesBlockedToday !== null &&
    telemetry?.queriesBlockedToday !== undefined
      ? telemetry.totalQueriesToday - telemetry.queriesBlockedToday
      : null;

  return (
    <div className="grid grid-cols-12 gap-6">
      <Card
        className="col-span-12"
        accent={status === 'active' ? 'good' : status === 'bypass' ? 'fault' : status ? 'warn' : 'none'}
      >
        <div className="flex flex-wrap items-center justify-between gap-8">
          <div className="flex items-center gap-6">
            <Icon className={`h-16 w-16 shrink-0 ${face?.tone ?? 'text-slate-600'}`} strokeWidth={1.5} />
            <div>
              <h2 className={`text-5xl font-light tracking-tight ${face?.tone ?? 'text-slate-500'}`}>
                {face?.title ?? 'Reading protection state…'}
              </h2>
              <p className="mt-2 text-base text-slate-400">
                {status === 'paused' && (
                  <>
                    {filtering?.durationLabel ?? 'Paused'}
                    {filtering?.secondsRemaining !== null && filtering?.secondsRemaining !== undefined && (
                      <> — resumes in {duration(filtering.secondsRemaining)}</>
                    )}
                    {filtering?.reason ? ` · "${filtering.reason}"` : ''}
                  </>
                )}
                {status === 'bypass' && (
                  <>
                    The DNS watchdog fell back to an unfiltered resolver. Nobody chose this — it is a fault, and
                    it needs the Filtering tab.
                  </>
                )}
                {status === 'active' && (
                  <>
                    Threat level {filtering?.threatLevel.level ?? DASH} ·{' '}
                    {num(filtering?.threatLevel.blocklistCount)} blocklists ·{' '}
                    {filtering?.categories.filter((c) => c.enabled).length ?? 0} content categories on
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-10">
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Devices seen</p>
              <p className="font-mono text-4xl tabular-nums text-slate-100">{num(deviceCount)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Node uptime</p>
              <p className="font-mono text-4xl tabular-nums text-slate-100">
                {duration(telemetry?.uptimeSeconds)}
              </p>
            </div>
          </div>
        </div>
        <GapNote text={telemetry?.gap} />
      </Card>

      <div className="col-span-8 grid grid-cols-2 gap-6">
        <StatTile
          label="DNS queries today"
          value={num(telemetry?.totalQueriesToday)}
          series={queries.samples}
          gap={telemetry?.totalQueriesToday === null ? telemetry?.gap : null}
        />
        <StatTile
          label="Blocked today"
          value={num(telemetry?.queriesBlockedToday)}
          series={blocked.samples}
          tone={telemetry?.queriesBlockedToday ? 'good' : 'default'}
        />
        <StatTile label="Data saved" value={telemetry?.dataSavedMB === null ? DASH : `${num(telemetry?.dataSavedMB, 1)}`} unit="MB" />
        <StatTile
          label="Average latency"
          value={telemetry?.avgLatencyMs === null ? DASH : num(telemetry?.avgLatencyMs, 1)}
          unit="ms"
        />
      </div>

      <Card title="Query split" className="col-span-4" subtitle="Allowed against blocked, today.">
        <div className="flex items-center justify-center py-2">
          <Gauge value={telemetry?.blockPercentage ?? null} label="blocked" tone={COLORS.orange} />
        </div>
        <div className="mt-4">
          <ProportionBar
            parts={[
              { label: 'Allowed', value: allowed, colour: COLORS.blue },
              { label: 'Blocked', value: telemetry?.queriesBlockedToday ?? null, colour: COLORS.orange },
            ]}
          />
        </div>
        {telemetry?.blockPercentage === null && (
          <GapNote text={telemetry?.gap ?? 'no query source — nothing to split'} />
        )}
      </Card>

      <Card title="Appliance load" className="col-span-12" subtitle="Live host readings from the Pi itself.">
        <div className="grid grid-cols-4 gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">CPU</p>
            <p className="mt-1 font-mono text-3xl tabular-nums text-slate-100">{pct(telemetry?.host?.cpuPercent)}</p>
            <Sparkline samples={cpu.samples} height={44} max={100} stroke={COLORS.cyan} className="mt-2" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Temperature</p>
            <p
              className={`mt-1 font-mono text-3xl tabular-nums ${
                (telemetry?.host?.tempC ?? 0) >= 80 ? 'text-[#E11D48]' : 'text-slate-100'
              }`}
            >
              {telemetry?.host?.tempC === null || telemetry?.host?.tempC === undefined
                ? DASH
                : `${telemetry.host.tempC.toFixed(1)}°`}
            </p>
            <Sparkline samples={temp.samples} height={44} max={90} stroke={COLORS.orange} className="mt-2" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Memory</p>
            <p className="mt-1 font-mono text-3xl tabular-nums text-slate-100">
              {num(telemetry?.host?.memUsedMB)}
              <span className="text-lg text-slate-500"> / {num(telemetry?.host?.memTotalMB)} MB</span>
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Disk used</p>
            <p className="mt-1 font-mono text-3xl tabular-nums text-slate-100">{pct(telemetry?.host?.diskUsedPercent)}</p>
          </div>
        </div>
        <SinceNote since={cpu.since} extra="Stored history arrives with the telemetry tables (plan Phase 3)." />
      </Card>
    </div>
  );
}

// ===========================================================================
// Filtering — the owner's three choices
// ===========================================================================

export function FilteringPanel({
  filtering,
  authority,
  onSetLevel,
  onSetCategories,
  onPause,
  onResume,
  busy,
  error,
}: PanelContext & {
  onSetLevel: (level: ThreatLevelId) => void;
  onSetCategories: (ids: string[]) => void;
  onPause: (d: PauseDurationId, reason?: string) => void;
  onResume: () => void;
  busy: boolean;
  error: string | null;
}) {
  const [reason, setReason] = useState('');
  const canWrite = authority === 'console';

  if (!filtering) {
    return <EmptyState title="Reading filtering state…" detail="Waiting for the agent to answer /api/v1/filtering." />;
  }

  const enabledCategories = filtering.categories.filter((c) => c.enabled).map((c) => c.id);

  return (
    <div className="grid grid-cols-12 gap-6">
      {error && (
        <div className="col-span-12 rounded-xl border border-[#E11D48]/50 bg-[#E11D48]/10 px-5 py-4 text-sm text-[#E11D48]">
          {error}
        </div>
      )}

      {/* --- Protection on/off ------------------------------------------- */}
      <Card
        className="col-span-12"
        title="Protection"
        subtitle={
          filtering.protectionStatus === 'bypass'
            ? 'The watchdog has fallen back to an unfiltered resolver. This is a fault, not a setting — resuming will not fix it on its own.'
            : 'Filtering can be switched off deliberately. It always says so, and a timed pause always expires on its own.'
        }
        accent={filtering.protectionStatus === 'active' ? 'good' : filtering.protectionStatus === 'bypass' ? 'fault' : 'warn'}
        right={
          filtering.enabled ? null : (
            <ActionButton onClick={onResume} disabled={!canWrite || busy}>
              Resume filtering now
            </ActionButton>
          )
        }
      >
        {!canWrite && <ViewerNotice what="Pausing and resuming filtering" />}

        {filtering.enabled ? (
          <div className="mt-1">
            <p className="mb-4 text-sm text-slate-400">
              Pause for a fixed period. The two longest options are held rather than tapped — a pause that
              outlives the person who set it is how a household ends up unprotected without knowing.
            </p>
            <div className="flex flex-wrap gap-3">
              {filtering.pauseDurations.map((d) =>
                d.requiresConfirmation ? (
                  <HoldButton
                    key={d.id}
                    label={`Hold — ${d.label}`}
                    tone="danger"
                    disabled={!canWrite || busy}
                    onConfirm={() => onPause(d.id, reason || undefined)}
                  />
                ) : (
                  <ActionButton
                    key={d.id}
                    tone="ghost"
                    disabled={!canWrite || busy}
                    onClick={() => onPause(d.id, reason || undefined)}
                  >
                    {d.label}
                  </ActionButton>
                ),
              )}
            </div>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 80))}
              placeholder="Why? (optional — shown to whoever finds it off)"
              disabled={!canWrite}
              className="mt-4 h-12 w-full max-w-xl rounded-xl border border-[#1E293B] bg-[#0F1B2D] px-4 text-base text-slate-200 outline-none placeholder:text-slate-600 focus:border-[#38BDF8]"
            />
          </div>
        ) : (
          <div className="rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 p-5">
            <p className="text-lg text-slate-200">
              {filtering.protectionStatus === 'bypass'
                ? 'Unfiltered because the DNS stack failed over.'
                : `Paused — ${filtering.durationLabel ?? 'unknown duration'}`}
            </p>
            {filtering.secondsRemaining !== null && (
              <p className="mt-1 font-mono text-3xl tabular-nums text-[#F59E0B]">
                {duration(filtering.secondsRemaining)} remaining
              </p>
            )}
            {filtering.reason && <p className="mt-2 text-sm text-slate-400">Reason given: “{filtering.reason}”</p>}
          </div>
        )}
      </Card>

      {/* --- Threat level ------------------------------------------------- */}
      <Card
        className="col-span-7"
        title="Threat level"
        subtitle="How much danger is blocked. Every list behind this dial blocks something actively hostile — malware, phishing, command-and-control, tracking."
      >
        {!canWrite && <ViewerNotice what="The threat level" />}
        <SegmentedControl<ThreatLevelId>
          value={filtering.threatLevel.level}
          disabled={!canWrite || busy}
          onChange={onSetLevel}
          options={filtering.availableLevels.map((l) => ({
            id: l.level as ThreatLevelId,
            label: l.level.charAt(0).toUpperCase() + l.level.slice(1),
            hint: `${l.description} · ${l.blocklistCount} lists`,
          }))}
        />
        <p className="mt-4 text-sm text-slate-500">
          Changing this rebuilds the blocklists and regenerates gravity, which takes tens of seconds on a Pi. The
          setting is saved immediately; the effect follows.
        </p>
      </Card>

      {/* --- Content categories ------------------------------------------- */}
      <Card
        className="col-span-5"
        title="Content categories"
        subtitle="What content is blocked. These are a household preference, not a threat — every one ships off."
      >
        {!canWrite && <ViewerNotice what="Content categories" />}
        <div className="space-y-3">
          {filtering.categories.map((c) => (
            <div
              key={c.id}
              className="flex items-start justify-between gap-4 rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 p-4"
            >
              <div>
                <p className="text-base font-medium text-slate-200">{c.label}</p>
                <p className="mt-0.5 text-sm text-slate-500">{c.description}</p>
                {/* Said out loud BEFORE the switch is flipped — a category that
                    quietly breaks WhatsApp is a support call. */}
                {c.caution && <GapNote text={c.caution} />}
              </div>
              <Toggle
                label={c.label}
                checked={c.enabled}
                disabled={!canWrite || busy}
                onChange={(next) =>
                  onSetCategories(
                    next ? [...enabledCategories, c.id] : enabledCategories.filter((id) => id !== c.id),
                  )
                }
              />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ===========================================================================
// Threats
// ===========================================================================

export function ThreatsPanel({ active }: PanelContext) {
  const threats = usePolled<ThreatsResponse>('/threats/recent?limit=50', 10000, active);
  const entries = threats.data?.entries ?? [];

  const topDomains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [entries]);

  const blockedCount = entries.filter((e) => e.action === 'Blocked').length;
  const peak = topDomains[0]?.[1] ?? 1;

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 grid grid-cols-3 gap-6">
        <StatTile label="Entries in window" value={num(entries.length)} />
        <StatTile label="Blocked" value={num(blockedCount)} tone={blockedCount ? 'good' : 'default'} />
        <StatTile
          label="Source"
          value={threats.data?.source === 'none' ? DASH : (threats.data?.source ?? DASH)}
          gap={threats.data?.gap}
        />
      </div>

      <Card
        className="col-span-5"
        title="Most frequent domains"
        subtitle="Counted from the entries the node returned — nothing is extrapolated."
      >
        {topDomains.length === 0 ? (
          <EmptyState
            title="Nothing to rank yet"
            detail={threats.data?.gap ?? 'No query entries have been returned in this window.'}
          />
        ) : (
          <div className="space-y-3">
            {topDomains.map(([domain, count]) => (
              <div key={domain}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="truncate font-mono text-sm text-slate-300">{domain}</span>
                  <span className="font-mono text-sm tabular-nums text-slate-400">{count}</span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#0F1B2D]">
                  <div
                    className="h-full rounded-full bg-[#FF8700] transition-all duration-500"
                    style={{ width: `${(count / peak) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card
        className="col-span-7"
        title="Recent queries"
        subtitle="Newest first. Domain, the device that asked, and what the node did about it."
      >
        {entries.length === 0 ? (
          <EmptyState
            title="No threat entries recorded"
            detail={
              threats.data?.gap ??
              'The node is reachable and reporting an empty log. That is the normal state of a fresh box.'
            }
          />
        ) : (
          <div className="max-h-[46vh] overflow-y-auto pr-1">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-[#111A28] text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-2 font-medium">Time</th>
                  <th className="py-2 font-medium">Domain</th>
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E293B]">
                {/*
                  Fields are timestamp / domain / clientIp / action — read from
                  threats.py. The previous console rendered `severity` and
                  `sourceIp`, which the node has never emitted: every row would
                  have shown an amber badge reading "undefined" the first time a
                  customer configured Pi-hole.
                */}
                {entries.map((e, i) => (
                  <tr key={`${e.timestamp}-${e.domain}-${i}`} className="text-sm">
                    <td className="py-2.5 font-mono text-slate-500">{clockTime(e.timestamp)}</td>
                    <td className="py-2.5 font-mono text-slate-200">{e.domain}</td>
                    <td className="py-2.5 font-mono text-slate-400">{e.clientIp}</td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider ${
                          e.action === 'Blocked'
                            ? 'bg-[#FF8700]/15 text-[#FF8700]'
                            : 'bg-[#1E293B] text-slate-400'
                        }`}
                      >
                        {e.action}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ===========================================================================
// Network — who is on it, and what they are reaching
// ===========================================================================

export function NetworkPanel({ active }: PanelContext) {
  const clients = usePolled<{ clients: LanClient[] }>('/clients', 6000, active);
  const flows = usePolled<FlowsResponse>('/flows/recent?limit=60', 10000, active);

  const list = clients.data?.clients ?? [];
  const count = useSeries(clients.data ? list.length : undefined);

  return (
    <div className="grid grid-cols-12 gap-6">
      <Card
        className="col-span-6"
        title="Devices on the network"
        subtitle="Discovered passively from the ARP table and DHCP leases. The node never probes."
        right={<span className="font-mono text-3xl tabular-nums text-slate-100">{num(list.length)}</span>}
      >
        {list.length === 0 ? (
          <EmptyState title="No devices observed yet" detail="Passive discovery only sees a device once it speaks." />
        ) : (
          <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
            {list.map((c) => (
              <div
                key={c.mac || c.ip}
                className="flex items-center justify-between rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 px-4 py-3"
              >
                <div>
                  {/* IP is the identity. A hostname is shown only when the node
                      supplied one — never derived from the MAC vendor prefix. */}
                  <p className="font-mono text-base text-slate-100">{c.ip}</p>
                  <p className="font-mono text-xs text-slate-500">{c.mac}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-slate-300">{c.hostname ?? <span className="text-slate-600">{DASH}</span>}</p>
                  <p className="text-xs uppercase tracking-wider text-slate-600">{c.interface}</p>
                </div>
              </div>
            ))}
          </div>
        )}
        <Sparkline samples={count.samples} height={40} stroke={COLORS.blue} className="mt-4" />
        <SinceNote since={count.since} />
      </Card>

      <Card
        className="col-span-6"
        title="Hostnames observed"
        subtitle="From TLS SNI and HTTP Host headers only."
      >
        {flows.data?.flows?.length ? (
          <div className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
            {flows.data.flows.map((f) => (
              <div
                key={`${f.source}-${f.hostname}`}
                className="flex items-center justify-between rounded-xl border border-[#1E293B] bg-[#0F1B2D]/60 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-mono text-base text-slate-100">{f.hostname}</p>
                  <p className="text-xs uppercase tracking-wider text-slate-600">
                    {f.protocol} · {f.source}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-lg tabular-nums text-slate-200">{num(f.count)}</p>
                  <p className="font-mono text-xs text-slate-500">{clockTime(f.lastSeen)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No flows captured"
            detail="Deep packet inspection needs CAP_NET_RAW and has to be running. An empty list here does not mean an idle network."
          />
        )}
        {/* The node's own caveat, printed rather than summarised: without it an
            empty list reads as "nothing is happening" when it may mean
            "everything is using Encrypted Client Hello". */}
        {flows.data?.note && <p className="mt-4 text-xs leading-relaxed text-slate-500">{flows.data.note}</p>}
        {flows.data?.truncated && (
          <p className="mt-2 text-xs text-[#F59E0B]">
            List truncated · {num(flows.data.evictions)} evictions since the agent started
          </p>
        )}
      </Card>

    </div>
  );
}
