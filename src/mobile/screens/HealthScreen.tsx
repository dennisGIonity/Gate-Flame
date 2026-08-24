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

import { Cpu, HardDrive, Thermometer, Timer } from 'lucide-react';

import type { FilteringState } from '../../types/filtering';
import {
  DASH,
  duration,
  num,
  pct,
  usePolled,
  type Polled,
  type ServiceModule,
  type TelemetrySummary,
} from '../../components/kiosk/kioskClient';
import { Card, Gap, Metric, Screen, ScreenTitle, Warning } from '../mobileUi';

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
      <ScreenTitle title="Box health" sub="How your Gate^Flame itself is doing." />

      {/* -------------------------------------------------- the big one */}
      {f && f.protectionStatus !== 'active' && f.protectionStatus !== 'paused' && (
        <Warning
          tone="fault"
          title="Your box is not filtering"
          detail={f.lastError ?? 'It is switched on and answering, but nothing is being blocked.'}
        />
      )}

      {f?.applying && (
        <Card accent="warn">
          <p className="text-sm text-[#F59E0B]">Updating the blocklist…</p>
          <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
            This takes up to a minute on the box. Your settings are saved already.
          </p>
        </Card>
      )}

      {telemetry.error?.unreachable && (
        <Warning
          title="I cannot reach the box from this phone"
          detail="Check this phone is on your home Wi-Fi. Nothing below is current."
        />
      )}

      {/* ------------------------------------------------------ hardware */}
      <Card>
        <div className="grid grid-cols-2 gap-5">
          <div className="flex items-start gap-2">
            <Thermometer className="mt-1 h-4 w-4 shrink-0 text-[#64748B]" />
            <Metric
              label="Temperature"
              value={host?.tempC == null ? DASH : host.tempC.toFixed(1)}
              unit="°C"
              tone={warm ? 'warn' : 'default'}
            />
          </div>
          <div className="flex items-start gap-2">
            <Cpu className="mt-1 h-4 w-4 shrink-0 text-[#64748B]" />
            <Metric label="Processor" value={pct(host?.cpuPercent)} />
          </div>
          <div className="flex items-start gap-2">
            <HardDrive className="mt-1 h-4 w-4 shrink-0 text-[#64748B]" />
            <Metric
              label="Storage used"
              value={pct(host?.diskUsedPercent)}
              tone={tight ? 'warn' : 'default'}
            />
          </div>
          <div className="flex items-start gap-2">
            <Timer className="mt-1 h-4 w-4 shrink-0 text-[#64748B]" />
            <Metric label="Running for" value={duration(host?.uptimeSeconds ?? t?.uptimeSeconds)} />
          </div>
        </div>
        <Gap text={t?.gap} />
      </Card>

      {warm && (
        <Warning
          title="The box is running warm"
          detail="Above 70 °C it slows itself down to cool off. Give it some air, and keep it out of a cupboard or direct sun."
        />
      )}
      {tight && (
        <Warning
          title="The box is running out of storage"
          detail="It needs room to keep the blocklist up to date. Worth mentioning to support before it fills."
        />
      )}

      {/* ------------------------------------------------------- modules */}
      <Card>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
          What your box is running
        </p>
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
        <div className="grid grid-cols-2 gap-5">
          <Metric label="Blocklist size" value={num(t?.domainsOnGravity)} hint="domains refused" />
          <Metric
            label="Filter service"
            value={t?.piholeReachable ? 'Answering' : 'Silent'}
            tone={t?.piholeReachable ? 'good' : 'fault'}
          />
        </div>
      </Card>
    </Screen>
  );
}
