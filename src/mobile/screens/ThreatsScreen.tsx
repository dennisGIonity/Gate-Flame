/**
 * Threats — what was refused, and which device asked for it.
 *
 * The empty state is the load-bearing part. "Nothing was blocked" and "we could
 * not ask the box" are completely different facts and a customer must never
 * have to guess which one they are looking at. The old app rendered an invented
 * list here; that defect has its own commit (eb7178f) and its own test.
 */

import { ShieldAlert } from 'lucide-react';

import {
  clockTime,
  usePolled,
  type ThreatsResponse,
} from '../../components/kiosk/kioskClient';
import { Card, DASH, Empty, Gap, Screen, ScreenTitle } from '../mobileUi';

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

  return (
    <Screen>
      <ScreenTitle
        title="Blocked"
        sub="The most recent things your box refused to look up."
      />

      {threats.error && (
        <Card accent="warn">
          <p className="text-sm text-[#F59E0B]">I could not read the block list from your box.</p>
          <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{threats.error.message}</p>
        </Card>
      )}

      {!threats.error && data && entries.length === 0 && (
        <Empty
          title="Nothing has been blocked yet"
          detail="This is a real answer, not a missing one — your box is answering and has refused nothing recently."
        />
      )}

      {entries.length > 0 && (
        <div className="flex flex-col gap-2">
          {entries.map((e, i) => (
            <Card key={`${e.domain ?? 'unknown'}-${i}`} className="!p-3">
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
          ))}
        </div>
      )}

      {/* The node explains its own gaps; we forward the sentence untouched. */}
      <Gap text={data?.gap} />
    </Screen>
  );
}
