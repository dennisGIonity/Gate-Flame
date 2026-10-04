/**
 * The router step, read back on the phone.
 *
 * ADR-001 asks the customer for exactly one action: set the router's DNS to
 * this box. Until 2026-10-03 nothing in the app said whether that had
 * happened, so a household could run for months with the router quietly using
 * its own upstream and every screen looking fine. This card reads
 * /network/router-check and says which of three things is true.
 *
 * The three are kept apart on purpose, and so are the ways of not knowing:
 *
 *   forwardsToUs true    the router sends lookups here            one line
 *   forwardsToUs false   checked, and it does not                 the fix + the router page
 *   forwardsToUs null    the box could not tell                   the node's `gap`, verbatim
 *   still asking         no reading yet                           a shimmer, never a verdict
 *   404                  an agent from before this route existed  "cannot check … yet"
 *   unreachable          nothing answered                         "Cannot reach your box."
 *   refused              the box answered with an error           its own sentence
 *
 * `null` is NEVER drawn as "not using your box": undetermined is not false,
 * and telling someone to fix a router that may be fine sends them into their
 * router's admin page for nothing. "Cannot reach it" and "reached it, nothing
 * there" never share a sentence (CLAUDE.md, load-bearing principles).
 *
 * The router page link is offered only for a private IPv4 address. The address
 * comes from the node, so the same guard the app applies to its own requests
 * (`assertPrivateHost`) decides whether it is fit to open.
 */

import type { ReactNode } from 'react';
import { CheckCircle2, ExternalLink, Router as RouterIcon } from 'lucide-react';

import type { Polled } from '../components/kiosk/kioskClient';
import { assertPrivateHost } from '../services/apiClient';
import type { RouterCheckResponse } from '../types/routerCheck';
import { Card, DASH, Gap, Skeleton } from './mobileUi';

/** Every 30 s: a router setting changes when a person changes it, not by itself. */
export const ROUTER_CHECK_PATH = '/network/router-check';
export const ROUTER_CHECK_INTERVAL_MS = 30_000;

/** The router's admin page, or null when the address is not one to open. */
export function routerPageUrl(gateway: string | null | undefined): string | null {
  if (!gateway) return null;
  const host = gateway.trim();
  // A bare dotted quad and nothing else: no scheme, no path, no port tricks.
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  const url = `http://${host}/`;
  try {
    assertPrivateHost(url);
  } catch {
    return null;
  }
  return url;
}

export function RouterCheckCard({ check }: { check: Polled<RouterCheckResponse> }) {
  const r = check.data;
  const err = check.error;

  // An error outranks a payload the hook may still be holding from an earlier
  // poll: a stale "yes" is not a reading.
  if (err) {
    return (
      <RouterFrame tone="none">
        <p className="text-sm text-slate-300">
          {err.status === 404
            ? 'This box cannot check your router yet'
            : err.unreachable
              ? 'Cannot reach your box.'
              : `Your box answered, but with an error: ${err.message}`}
        </p>
      </RouterFrame>
    );
  }

  if (!r) {
    return (
      <RouterFrame tone="none">
        <div className="flex flex-col gap-2" aria-label="Asking your box about your router">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </RouterFrame>
    );
  }

  if (r.forwardsToUs === true) {
    return (
      <RouterFrame tone="good">
        <p className="flex items-start gap-2 text-sm text-slate-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" aria-hidden />
          <span>
            {r.boxAddress
              ? `Your router is sending lookups to your box at ${r.boxAddress}`
              : 'Your router is sending lookups to your box'}
          </span>
        </p>
        <Gap text={r.gap} />
      </RouterFrame>
    );
  }

  if (r.forwardsToUs === false) {
    const page = routerPageUrl(r.gateway);
    return (
      <RouterFrame tone="warn">
        <p className="text-sm leading-relaxed text-slate-200">
          {r.boxAddress
            ? `Your router is not using your box yet — set its DNS to ${r.boxAddress}`
            : 'Your router is not using your box yet'}
        </p>
        {r.gateway && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1E293B] bg-[#0F1B2D] px-3 py-2">
            <span className="font-mono text-xs tabular-nums text-[#94A3B8]">{r.gateway}</span>
            {page && (
              <a
                href={page}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-[#38BDF8] underline decoration-dotted underline-offset-4"
              >
                Open router page <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            )}
          </div>
        )}
        <Gap text={r.gap} />
      </RouterFrame>
    );
  }

  // forwardsToUs is null: the box could not tell. Its reason, in its words -
  // or the dash when it gave none. Never a guess in either direction.
  return (
    <RouterFrame tone="none">
      {r.gap ? (
        <p className="text-sm leading-relaxed text-slate-300">{r.gap}</p>
      ) : (
        <p className="font-mono text-sm text-[#475569]">{DASH}</p>
      )}
    </RouterFrame>
  );
}

function RouterFrame({
  tone,
  children,
}: {
  tone: 'good' | 'warn' | 'none';
  children: ReactNode;
}) {
  return (
    <Card accent={tone}>
      <div className="mb-2 flex items-center gap-2">
        <RouterIcon className="h-4 w-4 text-[#38BDF8]" aria-hidden />
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[#64748B]">Your router</p>
      </div>
      {children}
    </Card>
  );
}
