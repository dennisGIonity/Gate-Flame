/**
 * Threats — what was refused, and which device asked for it.
 *
 * The empty state is the load-bearing part. "Nothing was blocked" and "we could
 * not ask the box" are completely different facts and a customer must never
 * have to guess which one they are looking at. The old app rendered an invented
 * list here; that defect has its own commit (eb7178f) and its own test.
 */

import { ShieldAlert } from 'lucide-react';

import { useMemo } from 'react';

import {
  clockTime,
  num,
  usePolled,
  useSeries,
  type ThreatsResponse,
} from '../../components/kiosk/kioskClient';
import { AreaChart, BarList, CH, Delta, RingGauge } from '../../components/kiosk/charts';
import { Card, ChartCard, Chip, DASH, Empty, Gap, Screen, ScreenTitle, SlideIn } from '../mobileUi';

/**
 * FTL's own verdict, in words a customer can read.
 *
 * Unmapped codes fall through UNCHANGED rather than being flattened to
 * "blocked". A status we have not seen before is information, and hiding it
 * behind a friendly word is how a real signal gets lost.
 */
function plainReason(status: string): string {
  const s = status.toUpperCase();
  if (s.includes('GRAVITY')) return 'on your blocklist';
  if (s.includes('REGEX')) return 'matched a rule';
  if (s.includes('DENYLIST')) return 'on your deny list';
  if (s.includes('EXTERNAL')) return 'refused upstream';
  return status;
}

export function ThreatsScreen({ active }: { active: boolean }) {
  const threats = usePolled<ThreatsResponse>('/threats/recent?limit=60', 8000, active);
  const data = threats.data;
  const entries = data?.entries ?? [];

  const blockedTrend = useSeries(data ? (data.blockedInWindow ?? null) : undefined);

  /**
   * The worst offenders, ranked.
   *
   * Counted from the entries the node actually returned, so this is "in this
   * window" and nothing more — it is not extrapolated to a day, and the
   * footer says so. A ranked list that quietly implies a daily total is the
   * kind of small dishonesty that costs trust the first time someone checks.
   */
  const topDomains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      if (!e.domain) continue;
      counts.set(e.domain, (counts.get(e.domain) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, value]) => ({ label, value }));
  }, [entries]);

  // Only when BOTH figures are real. A rate computed from a missing scanned
  // count would be a confident percentage derived from an unknown.
  const rate = data && data.scanned ? ((data.blockedInWindow ?? 0) / data.scanned) * 100 : null;

  return (
    <Screen>
      <ScreenTitle
        kicker="03 · Refusals"
        title="Blocked"
        sub="Most recently refused."
        right={
          data ? <Chip tone={entries.length ? 'warn' : 'good'}>{num(entries.length)} shown</Chip> : null
        }
      />

      {/* ------------------------------------------------- detection rate */}
      {data && (
        <Card>
          <div className="flex items-center gap-5">
            <RingGauge value={rate} sub="refused" tone={CH.orange} size={112} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-200">Of what your box examined</p>
              <p className="mt-1 text-xs leading-relaxed text-[#64748B]">
                {num(data.blockedInWindow ?? null)} refused out of {num(data.scanned ?? null)} it
                looked at. This is the recent window, not your whole day.
              </p>
              <div className="mt-3">
                <AreaChart
                  samples={blockedTrend.samples}
                  height={36}
                  stroke={CH.orange}
                  showAxis={false}
                  label="blocked in window"
                />
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* --------------------------------------------------- top offenders */}
      {topDomains.length > 0 && (
        <ChartCard
          label="Asked for most often"
          tone={CH.orange}
          right={<Delta samples={blockedTrend.samples} />}
          footer="From the entries above only."
        >
          <BarList rows={topDomains} colour={CH.orange} />
        </ChartCard>
      )}

      {threats.error && (
        <Card accent="warn">
          <p className="text-sm text-[#F59E0B]">Could not read the block list.</p>
          <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{threats.error.message}</p>
        </Card>
      )}

      {!threats.error && data && entries.length === 0 && (
        <Empty
          title="Nothing has been blocked yet"
          detail="A real answer: nothing refused recently."
        />
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => (
            <SlideIn key={`${e.domain ?? 'unknown'}-${i}`} index={i}>
            <Card className="!p-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FF8700]" />
                <div className="min-w-0 flex-1">
                  {/* break-all: ad domains are long and must not push the card wide */}
                  <p className="break-all font-mono text-[13px] leading-snug text-slate-200">
                    {e.domain ?? DASH}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#64748B]">
                    {/* clientName is usually null and is never inferred - a guessed
                        device name on a security log is worse than none. */}
                    {(e.clientName ?? e.clientIp) && (
                      <span>asked by {e.clientName ?? e.clientIp}</span>
                    )}
                    {e.status && <span className="font-mono">{plainReason(e.status)}</span>}
                    <span className="font-mono tabular-nums">{clockTime(e.timestamp)}</span>
                  </div>
                </div>
              </div>
            </Card>
            </SlideIn>
          ))}
        </div>
      )}

      {/* The node explains its own gaps; we forward the sentence untouched. */}
      <Gap text={data?.gap} />
    </Screen>
  );
}
