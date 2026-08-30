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
import { Check, Loader2 } from 'lucide-react';

import type { FilteringState, PauseDurationId, ThreatLevelId } from '../../types/filtering';
import { kioskApi, num, type Polled } from '../../components/kiosk/kioskClient';
import { CH, Meter } from '../../components/kiosk/charts';
import { Card, Chip, Gap, Screen, ScreenTitle, Warning } from '../mobileUi';

export function ControlsScreen({ filtering }: { filtering: Polled<FilteringState> }) {
  const f = filtering.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

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
              ? 'Cannot reach your box.'
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
        sub="Changeable from here."
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
          Higher blocks more, and more false positives.
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
              Nothing blocked until it is back on.
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
              Longer pauses: at the box only.
            </p>
          </>
        )}
      </Card>

      <Gap text={f.lastError} />
    </Screen>
  );
}
