/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame API types: history (1.1.0)
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Typed by reading node-agent/gateflame/dns_history.py and system_history.py,
 * not the plan that described them. Field names match the Python payloads
 * exactly.
 *
 * Three facts about both routes that every screen drawing them depends on:
 *
 *   1. NEVER A 500. A failure is `points: []` plus a `gap` naming what could
 *      not be read. A window outside the three below is a 400; an agent older
 *      than 1.1.0 answers 404.
 *   2. SPARSE. A bucket with nothing stored is left OUT, not written as zero:
 *      "the box was off" (weekly load shedding) and "the household made no
 *      lookups" are different facts, and a zero would claim the second.
 *   3. `t` IS A BUCKET START IN THE BOX'S CLOCK (Unix seconds), aligned to a
 *      multiple of `stepSeconds`. The box's clock, not the phone's: a Pi with no
 *      NTP drifts by days (the lab box sat four days behind on 2026-09-24), so
 *      a screen that places these points against `Date.now()` can find none of
 *      them inside "the last 24 hours" and draw an empty chart over real data.
 */

export type HistoryWindow = '24h' | '7d' | '30d';

/* ---- GET /api/v1/dns/history?window=… -------------------------------- */

export interface DnsHistoryPoint {
  t: number;
  total: number | null;
  blocked: number | null;
  cached: number | null;
  forwarded: number | null;
}

export interface DnsHistoryResponse {
  window: HistoryWindow;
  stepSeconds: number;
  /** The node's own words for one bucket, e.g. "10 minute totals". */
  resolution: string;
  source: 'pihole' | string;
  points: DnsHistoryPoint[];
  gap: string | null;
  /** Box clock, Unix seconds, when the payload was built. */
  fetchedAt?: number;
}

/* ---- GET /api/v1/history/system?window=… ----------------------------- */

export interface SystemHistoryPoint {
  t: number;
  cpu: number | null;
  memPct: number | null;
  tempC: number | null;
  diskPct: number | null;
}

export interface SystemHistoryResponse {
  window: HistoryWindow;
  stepSeconds: number;
  /** The node's own words for one bucket, e.g. "5 minute averages". */
  resolution: string;
  points: SystemHistoryPoint[];
  /** The first sample this box ever stored (box clock), or null. */
  since: number | null;
  gap: string | null;
  /** False when the 60 s sampler is not running; `gap` then says so. */
  sampling?: boolean;
  sampleIntervalSeconds?: number | null;
}
