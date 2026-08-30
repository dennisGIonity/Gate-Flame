/**
 * Activity — what the box has been doing, as pictures.
 *
 * Everything here is live sampling, not history. The agent has no telemetry
 * table yet, so a reboot is amnesia and this screen says so rather than drawing
 * a 24-hour axis it cannot fill. The previous app drew exactly that axis, with
 * a curve that came from nowhere.
 *
 * That constraint is also the design: because every line starts empty when the
 * app opens, the charts have to look deliberate WHILE EMPTY. `AreaChart` says
 * "collecting samples…" in a dashed frame rather than drawing a flat line
 * along the floor — a flat line at zero is a claim, and it is the wrong one.
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
import { AnimatedNumber, AreaChart, CH, Delta, Meter, RingGauge } from '../../components/kiosk/charts';
import { Card, ChartCard, Gap, Metric, Screen, ScreenTitle, Tiles } from '../mobileUi';

export function ActivityScreen({ telemetry }: { telemetry: Polled<TelemetrySummary> }) {
  const t = telemetry.data;

  const queries = useSeries(t?.totalQueriesToday ?? null);
  const blocked = useSeries(t?.queriesBlockedToday ?? null);
  const clients = useSeries(t?.activeClientsCount ?? null);
  const share = useSeries(t?.blockPercentage ?? null);

  return (
    <Screen>
      <ScreenTitle
        kicker="01 · Live"
        title="Activity"
        sub="Live only — no history kept yet."
      />

      {/* ------------------------------------------------- share blocked */}
      <Card>
        <div className="flex items-center gap-5">
          <RingGauge
            value={t?.blockPercentage ?? null}
            sub="refused"
            tone={CH.orange}
            size={124}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-200">Share of lookups blocked</p>
            <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
              Ads and trackers your devices asked for and did not get. A low number on a quiet
              network is normal.
            </p>
            <div className="mt-3">
              <AreaChart
                samples={share.samples}
                height={36}
                stroke={CH.orange}
                max={100}
                showAxis={false}
                label="blocked share"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------------- lookups */}
      <ChartCard
        label="Lookups"
        value={num(t?.totalQueriesToday)}
        tone={CH.cyan}
        right={<Delta samples={queries.samples} />}
      >
        <AreaChart samples={queries.samples} height={92} stroke={CH.cyan} label="lookups" />
      </ChartCard>

      {/* ------------------------------------------------------- blocked */}
      <ChartCard
        label="Blocked"
        value={num(t?.queriesBlockedToday)}
        tone={CH.orange}
        right={<Delta samples={blocked.samples} />}
      >
        <AreaChart samples={blocked.samples} height={92} stroke={CH.orange} label="blocked" />
      </ChartCard>

      {/* ------------------------------------------------------- devices */}
      <ChartCard
        label="Devices talking to the box"
        value={num(t?.activeClientsCount)}
        tone={CH.green}
        right={<Delta samples={clients.samples} />}
        footer="Counted via your router, not per device."
      >
        <AreaChart samples={clients.samples} height={70} stroke={CH.green} label="devices" />
      </ChartCard>

      {/* --------------------------------------------------- blocklist */}
      <Card>
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#64748B]">
          What is behind the filtering
        </p>
        <div className="space-y-4">
          {/*
            Scaled against 100,000 domains — roughly a full standard-tier
            gravity build. An arbitrary scale would be dishonest, but this one
            is the actual working figure, so a half-full bar genuinely means a
            half-sized blocklist. It also makes the empty case unmistakable:
            an empty gravity is the failure that shipped once already.
          */}
          <Meter
            label="Domains on the blocklist"
            value={t?.domainsOnGravity ?? null}
            max={100000}
            format={(v) => num(v)}
            tone={t?.domainsOnGravity ? CH.cyan : CH.red}
          />
          <Meter
            label="Share of lookups refused"
            value={t?.blockPercentage ?? null}
            max={100}
            unit="%"
            format={(v) => pct(v)}
          />
        </div>
        <Gap
          text={
            t && t.domainsOnGravity === 0
              ? 'Blocklist is empty — nothing is being refused.'
              : null
          }
        />
      </Card>

      {/* --------------------------------------------------------- rest */}
      <Card>
        <Tiles>
          <Metric
            label="Blocklist size"
            value={num(t?.domainsOnGravity)}
            hint="domains refused"
            tone={t?.domainsOnGravity === 0 ? 'fault' : 'default'}
          />
          <Metric label="Blocked share" value={pct(t?.blockPercentage)} />
          <Metric
            label="Data not fetched"
            value={t?.dataSavedMB == null ? DASH : bytes(t.dataSavedMB * 1024 * 1024)}
          />
          <Metric label="Box uptime" value={duration(t?.uptimeSeconds)} />
        </Tiles>
      </Card>

      {/* A single big figure to close on. It eases rather than snapping, which
          is the only motion on this screen that touches a headline number —
          and it renders the dash instantly when the reading is missing. */}
      <Card>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#64748B]">
          Refused since your box last started
        </p>
        <p className="mt-1 font-mono text-4xl font-semibold leading-none tracking-tight text-slate-100 sm:text-5xl">
          <AnimatedNumber value={t?.queriesBlockedToday ?? null} format={(v) => num(v)} />
        </p>
        <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
          out of <AnimatedNumber value={t?.totalQueriesToday ?? null} format={(v) => num(v)} />{' '}
          lookups it has answered.
        </p>
        <Gap text={t?.gap} />
      </Card>
    </Screen>
  );
}
