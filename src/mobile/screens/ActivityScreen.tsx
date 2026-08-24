/**
 * Activity — what the box has been doing, as pictures.
 *
 * Everything here is live sampling, not history. The agent has no telemetry
 * table yet, so a reboot is amnesia and this screen says so rather than drawing
 * a 24-hour axis it cannot fill. The previous app drew exactly that axis, with
 * a curve that came from nowhere.
 */

import {
  DASH,
  bytes,
  duration,
  num,
  pct,
  useSeries,
  type Polled,
  type TelemetrySummary,
} from '../../components/kiosk/kioskClient';
import { COLORS, Gauge, Sparkline } from '../../components/kiosk/kioskUi';
import { Card, Gap, Metric, Screen, ScreenTitle } from '../mobileUi';

export function ActivityScreen({ telemetry }: { telemetry: Polled<TelemetrySummary> }) {
  const t = telemetry.data;

  const queries = useSeries(t?.totalQueriesToday ?? null);
  const blocked = useSeries(t?.queriesBlockedToday ?? null);
  const clients = useSeries(t?.activeClientsCount ?? null);

  return (
    <Screen>
      <ScreenTitle
        title="Activity"
        sub="Live from your box. It starts when you open the app — the box does not keep a history yet."
      />

      {/* ------------------------------------------------- share blocked */}
      <Card>
        <div className="flex items-center gap-5">
          <Gauge value={t?.blockPercentage ?? null} size={116} tone={COLORS.orange} />
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-200">Share of lookups blocked</p>
            <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
              Ads and trackers your devices asked for and did not get. A low number on a quiet
              network is normal.
            </p>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------- lookups */}
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            Lookups
          </span>
          <span className="font-mono text-xs tabular-nums text-[#38BDF8]">
            {num(t?.totalQueriesToday)}
          </span>
        </div>
        <Sparkline samples={queries.samples} height={70} stroke={COLORS.cyan} />
      </Card>

      {/* ------------------------------------------------------- blocked */}
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            Blocked
          </span>
          <span className="font-mono text-xs tabular-nums text-[#FF8700]">
            {num(t?.queriesBlockedToday)}
          </span>
        </div>
        <Sparkline samples={blocked.samples} height={70} stroke={COLORS.orange} />
      </Card>

      {/* ------------------------------------------------------- devices */}
      <Card>
        <div className="mb-2 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[#64748B]">
            Devices talking to the box
          </span>
          <span className="font-mono text-xs tabular-nums text-[#10B981]">
            {num(t?.activeClientsCount)}
          </span>
        </div>
        <Sparkline samples={clients.samples} height={56} stroke={COLORS.running} />
        <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
          Your router asks on behalf of the whole house, so this counts what the box can see —
          not every gadget you own.
        </p>
      </Card>

      {/* --------------------------------------------------------- rest */}
      <Card>
        <div className="grid grid-cols-2 gap-5">
          <Metric label="Blocklist size" value={num(t?.domainsOnGravity)} hint="domains refused" />
          <Metric label="Blocked share" value={pct(t?.blockPercentage)} />
          <Metric
            label="Data not fetched"
            value={t?.dataSavedMB == null ? DASH : bytes(t.dataSavedMB * 1024 * 1024)}
          />
          <Metric label="Box uptime" value={duration(t?.uptimeSeconds)} />
        </div>
        <Gap
          text={
            t && t.domainsOnGravity === 0
              ? 'The blocklist is empty, so nothing is being refused. Open Help and I will check the box.'
              : null
          }
        />
      </Card>
    </Screen>
  );
}
