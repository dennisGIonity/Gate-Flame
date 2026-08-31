/**
 * Health — is the box itself well, and is anything wrong that you should know?
 *
 * THIS SCREEN IS WHY THE APP EXISTS AT ALL.
 *
 * After deployment the customer never looks at the console again. So every
 * warning the console would have shown on its wall has to arrive here instead,
 * or it arrives nowhere. On 2026-08-24 a box ran for its entire life filtering
 * nothing while every indicator read green, and the only reason anyone found
 * out was an engineer running `nslookup` by hand. That must never be the
 * detection mechanism again.
 *
 * Read-only on purpose. Anything that could break the household needs physical
 * presence at the box (`kiosk` scope, granted from a loopback socket), and a
 * control the phone would be refused for is not rendered at all — absent, not
 * disabled. A greyed-out button is still a question the customer has to ask.
 */

import { Cpu, Thermometer, Timer } from 'lucide-react';

import type { FilteringState } from '../../types/filtering';
import {
  DASH,
  duration,
  num,
  pct,
  usePolled,
  useSeries,
  type Polled,
  type ServiceModule,
  type TelemetrySummary,
} from '../../components/kiosk/kioskClient';
import { AreaChart, CH, Meter, RingGauge } from '../../components/kiosk/charts';
import { C, Card, Chip, Gap, Metric, Screen, ScreenTitle, Stat, Tiles, Warning } from '../mobileUi';

interface ServicesResponse {
  modules: ServiceModule[];
}

/** Above this the Pi will throttle itself. Not a fault, but worth saying. */
const WARM_C = 70;

export function HealthScreen({
  telemetry,
  filtering,
  active,
}: {
  telemetry: Polled<TelemetrySummary>;
  filtering: Polled<FilteringState>;
  active: boolean;
}) {
  const services = usePolled<ServicesResponse>('/services', 15000, active);
  const t = telemetry.data;
  const host = t?.host ?? null;
  const f = filtering.data;

  const cpu = useSeries(host?.cpuPercent ?? null);
  const temp = useSeries(host?.tempC ?? null);
  const modules = services.data?.modules ?? [];

  // Only genuine problems. A module that honestly reports `not_implemented` is
  // not a fault - it is a capability this box does not claim to have, and
  // showing it as a warning would train the customer to ignore warnings.
  const troubled = (services.data?.modules ?? []).filter(
    (m) => m.status === 'degraded' || m.status === 'failed',
  );

  const warm = host?.tempC != null && host.tempC >= WARM_C;
  const tight = host?.diskUsedPercent != null && host.diskUsedPercent >= 85;

  return (
    <Screen>
      <ScreenTitle
        kicker="05 · Diagnostics"
        title="Box health"
        sub="How your Gate^Flame itself is doing."
        right={
          telemetry.error?.unreachable ? (
            <Chip tone="fault">offline</Chip>
          ) : t?.piholeReachable ? (
            <Chip tone="good">answering</Chip>
          ) : (
            <Chip tone="warn">silent</Chip>
          )
        }
      />

      {/* -------------------------------------------------- the big one */}
      {f && f.protectionStatus !== 'active' && f.protectionStatus !== 'paused' && (
        <Warning
          tone="fault"
          title="Your box is not filtering"
          detail={f.lastError ?? 'On and answering, but blocking nothing.'}
        />
      )}

      {f?.applying && (
        <Card accent="warn">
          <p className="text-sm text-[#F59E0B]">Updating the blocklist…</p>
          <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
            Saved. Applying on the box.
          </p>
        </Card>
      )}

      {telemetry.error?.unreachable && (
        <Warning
          title="I cannot reach the box from this phone"
          detail="Nothing below is current."
        />
      )}

      {/* -------------------------------------------------------- vitals
          This card used to be TWO cards showing the same four readings — a
          stack of meters, then the identical figures again as icon tiles.
          Duplication is its own kind of clutter: it doubles the reading
          without adding a fact. One set now, each figure sitting on a bar
          that grows to it, so the level is readable without the number.

          The two live traces stay: an instant tells you the box is busy,
          the trace tells you whether it has been pinned — and pinned is
          what a failing SD card looks like from the outside.            */}
              <Card>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-1.5">
                <Cpu className="h-3.5 w-3.5 text-[#64748B]" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                  Processor
                </span>
              </div>
              <p className="mt-0.5 font-mono text-xl tabular-nums text-slate-100">
                {pct(host?.cpuPercent)}
              </p>
              <AreaChart samples={cpu.samples} height={52} max={100} stroke={CH.cyan} label="cpu" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <Thermometer className="h-3.5 w-3.5 text-[#64748B]" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
                  Temperature
                </span>
              </div>
              <p
                className={`mt-0.5 font-mono text-xl tabular-nums ${warm ? 'text-[#F59E0B]' : 'text-slate-100'}`}
              >
                {host?.tempC == null ? DASH : `${host.tempC.toFixed(1)}°`}
              </p>
              {/* 85 °C is the Pi's hard-throttle point, so the scale is a
                  physical limit rather than a round number. */}
              <AreaChart samples={temp.samples} height={52} max={85} stroke={CH.orange} label="temperature" />
            </div>
          </div>

          <div className="mt-5 space-y-3.5">
            <Stat
              label="Storage"
              value={pct(host?.diskUsedPercent)}
              pct={host?.diskUsedPercent}
              tone={tight ? C.amber : C.cyan}
              loading={!t && !telemetry.error}
            />
            <Stat
              label="Memory"
              value={
                host?.memUsedMB != null && host?.memTotalMB
                  ? `${(host.memUsedMB / 1024).toFixed(1)} / ${(host.memTotalMB / 1024).toFixed(1)} GB`
                  : DASH
              }
              pct={
                host?.memUsedMB != null && host?.memTotalMB
                  ? (host.memUsedMB / host.memTotalMB) * 100
                  : null
              }
              loading={!t && !telemetry.error}
            />
            <Stat
              label="Temperature"
              value={host?.tempC == null ? DASH : `${host.tempC.toFixed(1)} °C`}
              pct={host?.tempC == null ? null : (host.tempC / 85) * 100}
              tone={warm ? C.amber : C.green}
              loading={!t && !telemetry.error}
            />
          </div>

          <div className="mt-4 flex items-center gap-2 border-t border-[#1E293B] pt-3">
            <Timer className="h-3.5 w-3.5 text-[#64748B]" />
            <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
              Running for
            </span>
            <span className="ml-auto font-mono text-sm tabular-nums text-slate-100">
              {duration(host?.uptimeSeconds ?? t?.uptimeSeconds)}
            </span>
          </div>
          <Gap text={t?.gap} />
        </Card>

      {/* Warnings keep their words - they are the one place on this screen
          where a customer needs a sentence, because they have to DO
          something. Everything else became a bar. */}
      {warm && <Warning title="Running warm" detail="Over 70 °C it slows down. Give it air." />}
      {tight && <Warning title="Running out of storage" detail="It needs room for the blocklist." />}

      {/* ------------------------------------------------------- modules
          The list below only shows what is WRONG, which is right for a
          customer — but it leaves "everything is working" as a sentence with
          no evidence behind it. The ring is that evidence: a fraction of the
          box's own advertised capability, computed from its own registry.  */}
      <Card>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
          What your box is running
        </p>
        {modules.length > 0 && (
          <div className="mb-4 flex items-center gap-5">
            <RingGauge
              value={(modules.filter((m) => m.status === 'running').length / modules.length) * 100}
              sub="running"
              tone={troubled.length ? CH.amber : CH.green}
              size={104}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <Meter
                label="Working"
                value={modules.filter((m) => m.status === 'running').length}
                max={modules.length}
                format={(v) => `${v ?? 0} of ${modules.length}`}
                tone={CH.green}
              />
              {/* Shown as its own bar rather than folded into "working": a
                  capability this box never claimed is not a fault, and
                  colouring it like one teaches people to ignore warnings. */}
              <Meter
                label="Not fitted to this box"
                value={modules.filter((m) => m.status === 'not_implemented').length}
                max={modules.length}
                format={(v) => `${v ?? 0} of ${modules.length}`}
                tone={CH.muted}
              />
            </div>
          </div>
        )}
        {services.error && (
          <p className="text-xs text-[#F59E0B]">Could not read this from the box.</p>
        )}
        {!services.error && troubled.length === 0 && services.data && (
          <p className="text-sm text-[#10B981]">Everything your box does is working.</p>
        )}
        {troubled.map((m) => (
          <div key={m.id} className="mt-2 border-t border-[#1E293B] pt-2 first:mt-0 first:border-0 first:pt-0">
            <p className="text-sm text-slate-200">{m.label}</p>
            {/* The module's own words. Ours would be a paraphrase of a fault we
                cannot see from here. */}
            {m.gap && <p className="mt-0.5 text-[11px] leading-relaxed text-[#F59E0B]">{m.gap}</p>}
          </div>
        ))}
      </Card>

      <Card>
        <Tiles cols={3}>
          <Metric
            label="Blocklist size"
            value={num(t?.domainsOnGravity)}
            hint="domains refused"
            tone={t?.domainsOnGravity === 0 ? 'fault' : 'default'}
          />
          <Metric
            label="Filter service"
            value={t?.piholeReachable ? 'Answering' : 'Silent'}
            tone={t?.piholeReachable ? 'good' : 'fault'}
          />
          {/* Non-zero throttle flags on a Pi are almost always the power
              supply, and that is a fault the customer can actually fix. It
              belongs in front of them rather than only on the console. */}
          <Metric
            label="Power & cooling"
            value={
              host?.throttleFlags == null
                ? DASH
                : host.throttleFlags === '0x0'
                  ? 'Healthy'
                  : 'Throttled'
            }
            tone={host?.throttleFlags == null ? 'default' : host.throttleFlags === '0x0' ? 'good' : 'warn'}
            hint={
              host?.throttleFlags && host.throttleFlags !== '0x0'
                ? 'usually the power supply'
                : undefined
            }
          />
        </Tiles>
      </Card>
    </Screen>
  );
}
