/**
 * Network — what the box can see on your Wi-Fi.
 *
 * Passive only. `clients.py` reads the kernel neighbour table and the lease
 * files; it never probes. So this is "devices that have spoken recently", not
 * an inventory, and the copy says so — a list that quietly omits a switched-off
 * laptop would read as a security claim it cannot support.
 *
 * IP is the primary identifier because it is the one that is always true.
 * hostname is shown only when the network supplied one; it is never inferred.
 */

import { Laptop, Router as RouterIcon, Smartphone, HelpCircle } from 'lucide-react';

import { num, usePolled, useSeries, type LanClient } from '../../components/kiosk/kioskClient';
import { AreaChart, BarList, CH, Delta, RingGauge } from '../../components/kiosk/charts';
import { C, Card, ChartCard, Chip, DASH, Empty, Pulse, Screen, ScreenTitle, SlideIn } from '../mobileUi';

interface ClientsResponse {
  clients: LanClient[];
  gap?: string | null;
}

/**
 * A glyph, chosen from the hostname when the network gave us one.
 *
 * Cosmetic ONLY, and deliberately falls back to a neutral question mark rather
 * than guessing "phone". An icon is a claim like any other; the wrong one on a
 * security screen is a small lie that costs trust when someone notices.
 */
function glyph(hostname: string | null) {
  const h = (hostname ?? '').toLowerCase();
  if (!h) return HelpCircle;
  if (/phone|android|iphone|pixel|galaxy/.test(h)) return Smartphone;
  if (/book|laptop|desktop|pc|imac|mac/.test(h)) return Laptop;
  if (/router|gateway|ap\b|tplink|netgear/.test(h)) return RouterIcon;
  return HelpCircle;
}

export function NetworkScreen({ active }: { active: boolean }) {
  const clients = usePolled<ClientsResponse>('/clients', 10000, active);
  const list = clients.data?.clients ?? [];
  const seen = useSeries(clients.data ? list.length : undefined);

  // Grouped by the interface the box heard them on. This is the shape that
  // exposes dual-homing: the same /24 appearing under two interfaces makes DNS
  // intermittent and per-device, and nothing else the customer can see would
  // ever show it.
  const byInterface = [...new Set(list.map((c) => c.interface))].map((iface) => {
    const on = list.filter((c) => c.interface === iface);
    const subnets = [...new Set(on.map((c) => c.ip.split('.').slice(0, 3).join('.')))];
    return { label: iface || DASH, value: on.length, hint: `${subnets.join(', ')}.0/24` };
  });

  const named = list.filter((c) => Boolean(c.hostname)).length;

  return (
    <Screen>
      <ScreenTitle
        kicker="04 · Presence"
        title="Your network"
        sub="Heard from recently. Sleeping devices are absent."
        right={clients.data ? <Chip tone="cyan">{num(list.length)} heard</Chip> : null}
      />

      {/* ------------------------------------------------------- presence */}
      {clients.data && list.length > 0 && (
        <>
          <ChartCard
            label="Devices heard from"
            value={num(list.length)}
            tone={CH.green}
            right={<Delta samples={seen.samples} />}
            footer="Live only. A dip means quiet, not gone."
          >
            <AreaChart samples={seen.samples} height={76} stroke={CH.green} label="devices heard" />
          </ChartCard>

          <Card>
            <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-[#64748B]">
              How they reach the box
            </p>
            <div className="flex items-center gap-5">
              <RingGauge
                value={list.length ? (named / list.length) * 100 : null}
                sub="named"
                tone={CH.cyan}
                size={100}
              />
              <div className="min-w-0 flex-1">
                <BarList rows={byInterface} colour={CH.blue} />
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-[#64748B]">
              A device is only named here if your network published a name for it. The ring is how
              many did — it is not a measure of anything being wrong.
            </p>
          </Card>
        </>
      )}

      {clients.error && (
        <Card accent="warn">
          <p className="text-sm text-[#F59E0B]">I could not read the device list.</p>
          <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{clients.error.message}</p>
        </Card>
      )}

      {!clients.error && clients.data && list.length === 0 && (
        <Empty
          title="No devices heard from yet"
          detail="Nothing has spoken yet."
        />
      )}

      {list.length > 0 && (
        <div className="flex flex-col gap-2">
          {list.map((c, i) => {
            // `label` is decided on the node now (device_names.py): the name
            // the owner typed, else the vendor, else the MAC. This list used
            // to lead with the IP and print "name not published" underneath -
            // an address as a name, and a sentence explaining why it wasn't.
            const name = c.label || c.hostname || c.mac;
            const Icon = glyph(c.hostname ?? c.vendor ?? null);
            return (
              <SlideIn key={`${c.mac}-${c.ip}`} index={i}>
                <Card className="!p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#1E293B] bg-[#0F1B2D]">
                      <Icon className="h-4 w-4 text-[#38BDF8]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] text-slate-200">{name}</p>
                      <p className="truncate font-mono text-[10px] text-[#475569]">
                        {c.ip}
                        {c.vendor ? ` · ${c.vendor}` : c.randomisedMac ? ' · private address' : ''}
                      </p>
                    </div>
                    {/* A live dot instead of the interface name: which NIC the
                        box heard it on is engineering detail, not something a
                        household reads. */}
                    <Pulse tone={C.cyan} />
                  </div>
                </Card>
              </SlideIn>
            );
          })}
        </div>
      )}
    </Screen>
  );
}
