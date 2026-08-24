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

import { usePolled, type LanClient } from '../../components/kiosk/kioskClient';
import { Card, DASH, Empty, Screen, ScreenTitle } from '../mobileUi';

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

  return (
    <Screen>
      <ScreenTitle
        title="Your network"
        sub="Devices your box has heard from recently. It listens rather than scanning, so a device that is asleep will not be here."
      />

      {clients.error && (
        <Card accent="warn">
          <p className="text-sm text-[#F59E0B]">I could not read the device list.</p>
          <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{clients.error.message}</p>
        </Card>
      )}

      {!clients.error && clients.data && list.length === 0 && (
        <Empty
          title="No devices heard from yet"
          detail="Your box only sees a device once it speaks. Give it a few minutes."
        />
      )}

      {list.length > 0 && (
        <div className="flex flex-col gap-2">
          {list.map((c) => {
            const Icon = glyph(c.hostname);
            return (
              <Card key={`${c.mac}-${c.ip}`} className="!p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#1E293B] bg-[#0F1B2D]">
                    <Icon className="h-4 w-4 text-[#38BDF8]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[13px] text-slate-200">{c.ip}</p>
                    <p className="truncate text-[11px] text-[#64748B]">
                      {c.hostname ?? 'name not published'} · {c.mac || DASH}
                    </p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-[#475569]">
                    {c.interface}
                  </span>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <p className="px-1 pt-1 text-[11px] leading-relaxed text-[#64748B]">
        Your router asks the box on behalf of the whole house, so blocked lookups cannot always be
        traced back to one device. That is the trade for the box never being able to break your
        internet.
      </p>
    </Screen>
  );
}
