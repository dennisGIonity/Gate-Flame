/**
 * Gate^Flame — null-safe number formatting for surfaces.
 *
 * WHY THIS EXISTS
 *
 * The node-agent deliberately returns `null`, never `0`, for any figure Pi-hole
 * did not supply — `pihole.py` says so in terms: "Each field is None when
 * Pi-hole did not supply it, never 0. A zero here would be indistinguishable
 * from 'nothing blocked today', which is a real and different state."
 *
 * That is the right call on the box. It puts an obligation on every surface:
 * render the gap, never assume a number. The kiosk honoured it. The mobile
 * dashboard did not, and on 2026-08-24 a freshly paired handset took
 *
 *     Uncaught TypeError: Cannot read properties of null (reading 'toFixed')
 *
 * on `telemetry.dataSavedMB.toFixed(1)` and painted a black screen — the app
 * dead on the first screen a customer sees after pairing. Six call sites in
 * MobileDashboard.tsx made the same assumption.
 *
 * A dash is the honest render. It says "not measured" where a 0 would lie.
 */

/** Em dash. The single visual convention for "we do not have this number". */
export const DASH = '—';

type Num = number | null | undefined;

const missing = (v: Num): v is null | undefined =>
  v === null || v === undefined || Number.isNaN(v);

/** Thousands-separated integer, or a dash. */
export const count = (v: Num): string => (missing(v) ? DASH : v.toLocaleString());

/** Percentage with a trailing sign, or a dash. */
export const percent = (v: Num, dp = 0): string =>
  missing(v) ? DASH : `${v.toFixed(dp)}%`;

/** Fixed-decimal number, or a dash. */
export const decimal = (v: Num, dp = 1): string => (missing(v) ? DASH : v.toFixed(dp));

/**
 * Large counts, scaled to the magnitude they actually are.
 *
 * The previous code hardcoded millions: `(domainsOnGravity / 1_000_000).toFixed(1)`
 * plus a literal "M". A real box carrying 82,562 domains therefore displayed
 * "0.1M", which is technically true and reads as "almost nothing". The unit is
 * chosen from the value now, so the same figure reads "82.6K".
 *
 * Returns the suffix separately because the callers render it in its own
 * element at a different size.
 */
export const scaled = (v: Num): { value: string; unit: string } => {
  if (missing(v)) return { value: DASH, unit: '' };
  if (Math.abs(v) >= 1_000_000) return { value: (v / 1_000_000).toFixed(1), unit: 'M' };
  if (Math.abs(v) >= 1_000) return { value: (v / 1_000).toFixed(1), unit: 'K' };
  return { value: String(v), unit: '' };
};
