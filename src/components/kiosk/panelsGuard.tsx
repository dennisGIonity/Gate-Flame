/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: Guard
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The Guard tab: four things the 2026-09-10 build added to the node, on one
 * screen, each reading its own route and each honest about its own gaps.
 *
 *   Profiles      /profiles                  one tap sets level + categories
 *   Upstream      /dns/upstream              recursion (default) or Cloudflare
 *   Watch (ML)    /ml/anomalies              on-box findings, reasons to look
 *   Accessibility /profiles/accessibility    stored on the box for this panel
 *   Storage       /system/storage            the .DUMP root, folder by folder
 *
 * Rules carried over from every other panel here: a route that does not
 * answer renders as "did not answer", never as an empty all-clear; nothing is
 * invented; writes render the node's refreshed payload, not an optimistic
 * guess; a viewer (non-loopback) sees everything and can change nothing.
 */

import { useEffect, useState } from 'react';
import { Activity, Brain, Database, Eye, Globe2, Users } from 'lucide-react';

import { kioskApi, usePolled } from './kioskClient';
import { ActionButton, Card, EmptyState, GapNote, Toggle, ViewerNotice } from './kioskUi';
import type { PanelContext } from './panels';
import type {
  AccessibilityPrefs,
  AccessibilityResponse,
  AnomalyResponse,
  ProfileId,
  ProfilesResponse,
  StorageStatus,
  UpstreamModeId,
  UpstreamResponse,
} from '../../types/guard';

const DASH = '—';

function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return DASH;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return DASH;
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function GuardPanel({ authority, active }: PanelContext) {
  const canWrite = authority === 'console';
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const profiles = usePolled<ProfilesResponse>('/profiles', 10000, active);
  const upstream = usePolled<UpstreamResponse>('/dns/upstream', 15000, active);
  const anomalies = usePolled<AnomalyResponse>('/ml/anomalies', 30000, active);
  const access = usePolled<AccessibilityResponse>('/profiles/accessibility', 30000, active);
  const storage = usePolled<StorageStatus>('/system/storage', 30000, active);

  // Local mirror so a toggle moves at once; the polled value re-syncs it.
  const [prefs, setPrefs] = useState<AccessibilityPrefs | null>(null);
  useEffect(() => {
    if (access.data?.prefs) setPrefs(access.data.prefs);
  }, [access.data]);

  const run = async (key: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      after?.();
    } catch (err) {
      // A 409 from /dns/upstream arrives with the node's own sentence as the
      // message (kioskClient reads detail.applied.error). Show it verbatim.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const p = profiles.data;
  const u = upstream.data;
  const a = anomalies.data;
  const st = storage.data;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {!canWrite && (
        <div className="xl:col-span-2">
          <ViewerNotice what="Profiles, upstream, accessibility and the scan button" />
        </div>
      )}
      {error && (
        <div className="xl:col-span-2 rounded-xl border border-[#E11D48]/50 bg-[#E11D48]/[0.06] px-4 py-3 text-sm text-[#FDA4AF]">
          {error}
        </div>
      )}

      {/* ---- Profiles -------------------------------------------------- */}
      <Card
        title="Profile"
        subtitle="One choice that sets the threat level and the content categories together. Derived from what the box is actually doing — a hand-changed category shows as Custom."
        right={<Users className="h-5 w-5 text-slate-500" />}
      >
        {profiles.error && !p && <GapNote text={`Profiles did not answer: ${profiles.error.message}`} />}
        {p && (
          <>
            <div className="mb-4 flex items-baseline gap-3">
              <span className="text-2xl font-semibold text-slate-100">{p.activeLabel}</span>
              <span className="text-sm text-slate-400">
                level {p.threatLevel} · {p.categories.length ? p.categories.join(', ') : 'no content categories'}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {p.presets.map((preset) => {
                const isActive = preset.id === p.active;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={!canWrite || busy !== null}
                    onClick={() =>
                      void run(`profile:${preset.id}`, () => kioskApi.applyProfile(preset.id as ProfileId), profiles.refresh)
                    }
                    className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive
                        ? 'border-brand-teal/60 bg-brand-teal/10'
                        : 'border-[#1E293B] bg-[#0F1B2D] hover:border-[#334155]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base font-semibold text-slate-100">{preset.label}</span>
                      <span className="text-[11px] uppercase tracking-wider text-slate-500">
                        {preset.blocklistCount} lists
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{preset.description}</p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {p.appliedBy ? `Last preset applied by ${p.appliedBy} ${fmtAgo(p.appliedAt)}.` : 'No preset applied yet.'}
              {!p.storageWritable && ' Profiles folder is not writable — the choice still applies, but is not recorded.'}
            </p>
          </>
        )}
      </Card>

      {/* ---- Upstream ------------------------------------------------- */}
      <Card
        title="Where clean lookups go"
        subtitle="After this box has filtered a lookup, who answers it. The default keeps everything on this box."
        right={<Globe2 className="h-5 w-5 text-slate-500" />}
        accent={u && u.mode && u.mode !== 'recursive' ? 'warn' : 'none'}
      >
        {upstream.error && !u && <GapNote text={`Upstream did not answer: ${upstream.error.message}`} />}
        {u && !u.reachable && (
          <GapNote text="Pi-hole did not answer, so the current upstream is unknown. This is not the same as the default being on." />
        )}
        {u && (
          <>
            <div className="mb-4 text-sm text-slate-300">
              Now:{' '}
              <span className="font-semibold text-slate-100">
                {u.mode === null ? 'unknown' : u.mode === 'custom' ? `custom (${(u.upstreams ?? []).join(', ')})` : u.modes.find((m) => m.id === u.mode)?.label}
              </span>
              {u.operator && <span className="text-slate-400"> · seen by {u.operator}</span>}
              {u.encrypted === false && u.mode !== 'recursive' && u.mode !== null && (
                <span className="ml-2 rounded border border-[#F59E0B]/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[#F59E0B]">
                  not encrypted
                </span>
              )}
            </div>
            <div className="grid gap-3">
              {u.modes.map((m) => {
                const isActive = m.id === u.mode;
                return (
                  <button
                    key={m.id}
                    type="button"
                    disabled={!canWrite || busy !== null || !u.reachable}
                    onClick={() => void run(`upstream:${m.id}`, () => kioskApi.setUpstream(m.id as UpstreamModeId), upstream.refresh)}
                    className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      isActive ? 'border-brand-cyan/60 bg-brand-cyan/10' : 'border-[#1E293B] bg-[#0F1B2D] hover:border-[#334155]'
                    }`}
                  >
                    <div>
                      <div className="text-base font-semibold text-slate-100">
                        {m.label}
                        {m.isDefault && <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">default</span>}
                      </div>
                      <p className="mt-1 text-sm text-slate-400">{m.description}</p>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-slate-500">{m.upstreams.join(' · ')}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">{u.notice}</p>
            {u.lastApply?.error && <GapNote text={`Last change: ${u.lastApply.error}`} />}
          </>
        )}
      </Card>

      {/* ---- Watch (ML) ----------------------------------------------- */}
      <Card
        title="Watch"
        subtitle="On-box statistics over this box's own DNS log. Reasons to look, never verdicts. Nothing here blocks anything."
        right={<Brain className="h-5 w-5 text-slate-500" />}
        className="xl:col-span-2"
        accent={a && a.findings.some((f) => f.severity === 'high') ? 'warn' : 'none'}
      >
        {anomalies.error && !a && <GapNote text={`Watch did not answer: ${anomalies.error.message}`} />}
        {a?.gap && <GapNote text={a.gap} />}
        {a && !a.gap && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-slate-400">
              <span>
                Last run <span className="text-slate-200">{fmtAgo(a.ranAt)}</span>
              </span>
              <span>
                <span className="text-slate-200">{a.stats?.queriesInWindow ?? DASH}</span> lookups in{' '}
                {a.stats ? Math.round(a.stats.windowSeconds / 60) : DASH} min
              </span>
              <span>
                baseline <span className="text-slate-200">{a.stats?.baselineRuns ?? DASH}</span> runs ·{' '}
                <span className="text-slate-200">{a.stats?.knownDomains ?? DASH}</span> known domains
              </span>
              {a.stats?.clientAttribution === 'router-only' && (
                <span className="rounded border border-[#1E293B] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-500">
                  whole-house view — router forwards to this box, so devices are not told apart
                </span>
              )}
              {canWrite && (
                <ActionButton
                  tone="ghost"
                  className="ml-auto !min-h-9 !px-3 !py-1.5 !text-xs"
                  disabled={busy !== null}
                  onClick={() => void run('scan', () => kioskApi.runAnomalyScan(), anomalies.refresh)}
                >
                  <Activity className="mr-1 inline h-3.5 w-3.5" /> Scan now
                </ActionButton>
              )}
            </div>
            {a.findings.length === 0 ? (
              <EmptyState
                title="Nothing unusual in the last window"
                detail={`${a.stats?.queriesInWindow ?? 0} lookups scored against this box's own baselines. An empty list here means the scan ran and found nothing to show — a gap would be reported above instead.`}
              />
            ) : (
              <ul className="divide-y divide-[#1E293B]">
                {a.findings.map((f, i) => (
                  <li key={`${f.kind}-${f.domain ?? ''}-${f.clientIp ?? ''}-${i}`} className="flex items-start gap-4 py-3">
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                        f.severity === 'high' ? 'bg-[#E11D48]' : f.severity === 'medium' ? 'bg-[#F59E0B]' : 'bg-slate-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-100">{f.summary}</p>
                      <p className="mt-0.5 font-mono text-xs text-slate-500">
                        {f.kind} · confidence {Math.round(f.confidence * 100)}%
                        {f.clientIp ? ` · ${f.clientIp}` : ''}
                        {' · '}
                        {Object.entries(f.evidence)
                          .filter(([, v]) => typeof v !== 'object')
                          .map(([k, v]) => `${k}=${String(v)}`)
                          .join(' ')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">
              {a.notice}
              {a.model ? ` Model: ${a.model.name} v${a.model.version} — ${a.model.type}; ${a.model.trainedOn}.` : ''}
            </p>
          </>
        )}
      </Card>

      {/* ---- Accessibility -------------------------------------------- */}
      <Card
        title="Accessibility"
        subtitle="Display settings for this wall panel, remembered on the box across reboots."
        right={<Eye className="h-5 w-5 text-slate-500" />}
      >
        {access.error && !prefs && <GapNote text={`Accessibility did not answer: ${access.error.message}`} />}
        {prefs && (
          <div className="space-y-4">
            {(
              [
                ['reducedMotion', 'Reduce motion', 'Static splash and transitions. Also honoured when the OS asks for it.'],
                ['highContrast', 'High contrast', 'Stronger borders and text on every card.'],
                ['verboseLabels', 'Label every control', 'Text beside icon-only buttons.'],
              ] as const
            ).map(([key, label, hint]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-slate-200">{label}</div>
                  <div className="text-xs text-slate-500">{hint}</div>
                </div>
                <Toggle
                  label={label}
                  checked={prefs[key]}
                  disabled={!canWrite || busy !== null}
                  onChange={(next) => {
                    setPrefs({ ...prefs, [key]: next });
                    void run(`a11y:${key}`, () => kioskApi.setAccessibility({ [key]: next }), access.refresh);
                  }}
                />
              </div>
            ))}
            <div>
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-slate-200">Text size</div>
                <span className="font-mono text-xs text-slate-400">{Math.round(prefs.textScale * 100)}%</span>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {[0.9, 1.0, 1.15, 1.3, 1.5].map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={!canWrite || busy !== null}
                    onClick={() => {
                      setPrefs({ ...prefs, textScale: v });
                      void run('a11y:textScale', () => kioskApi.setAccessibility({ textScale: v }), access.refresh);
                    }}
                    className={`rounded-lg border py-2 text-sm disabled:opacity-60 ${
                      Math.abs(prefs.textScale - v) < 0.01
                        ? 'border-brand-teal/60 bg-brand-teal/10 text-slate-100'
                        : 'border-[#1E293B] bg-[#0F1B2D] text-slate-300'
                    }`}
                  >
                    {Math.round(v * 100)}%
                  </button>
                ))}
              </div>
            </div>
            {access.data && access.data.storageWritable === false && (
              <GapNote text="Profiles folder is not writable: these settings apply now but will not survive a reboot." />
            )}
          </div>
        )}
      </Card>

      {/* ---- Storage -------------------------------------------------- */}
      <Card
        title="Storage"
        subtitle="The box's data root. Every folder that exists and can be written is green; anything else is named."
        right={<Database className="h-5 w-5 text-slate-500" />}
        accent={st ? (st.healthy ? 'good' : 'fault') : 'none'}
      >
        {storage.error && !st && <GapNote text={`Storage did not answer: ${storage.error.message}`} />}
        {st && (
          <>
            <div className="mb-3 flex items-baseline justify-between text-sm">
              <span className="font-mono text-slate-300">{st.root}</span>
              <span className="text-slate-400">
                {fmtBytes(st.totalBytes)} used · {st.freeBytes === null ? DASH : `${fmtBytes(st.freeBytes)} free`}
              </span>
            </div>
            {!st.present && <GapNote text="The data root does not exist. Run install-automation.sh on the box." />}
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(st.subdirs).map(([name, d]) => {
                const ok = d.present && d.writable;
                return (
                  <li
                    key={name}
                    className={`rounded-lg border px-3 py-2 ${ok ? 'border-[#10B981]/30' : 'border-[#E11D48]/50 bg-[#E11D48]/[0.05]'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-slate-200">{name}/</span>
                      <span className={`h-2 w-2 rounded-full ${ok ? 'bg-[#10B981]' : 'bg-[#E11D48]'}`} />
                    </div>
                    <div className="text-xs text-slate-500">
                      {!d.present ? 'missing' : !d.writable ? 'read-only' : `${d.files} files · ${fmtBytes(d.bytes)}`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

export const GUARD_TAB_ICON = Brain;
