/**
 * A missing number must render as a gap, never as a zero, and never crash.
 *
 * REGRESSION FIXTURE: 2026-08-24. A handset paired to the live node and died
 * instantly on the first screen after pairing:
 *
 *     Uncaught TypeError: Cannot read properties of null (reading 'toFixed')
 *
 * `telemetry.dataSavedMB` was null, because the agent returns null - never 0 -
 * for any figure Pi-hole did not supply. That is deliberate and correct on the
 * box; the obligation it creates is that surfaces render the gap.
 */

import { describe, expect, it } from 'vitest';
import { count, DASH, decimal, percent, scaled } from './format';

describe('a missing number never crashes and never reads as zero', () => {
  const absent = [null, undefined, Number.NaN] as const;

  it.each(absent)('count(%s)', (v) => {
    expect(count(v)).toBe(DASH);
  });

  it.each(absent)('decimal(%s)', (v) => {
    expect(decimal(v)).toBe(DASH);
  });

  it.each(absent)('percent(%s)', (v) => {
    expect(percent(v)).toBe(DASH);
  });

  it.each(absent)('scaled(%s)', (v) => {
    expect(scaled(v).value).toBe(DASH);
  });

  /**
   * The load-bearing distinction. "Nothing was blocked today" and "we could not
   * measure what was blocked" are different states, and a 0 collapses them.
   */
  it('renders a real zero as a zero, not as a gap', () => {
    expect(count(0)).toBe('0');
    expect(decimal(0)).toBe('0.0');
    expect(percent(0)).toBe('0%');
    expect(scaled(0)).toEqual({ value: '0', unit: '' });
  });
});

describe('real values still format', () => {
  it('separates thousands', () => {
    expect(count(131068)).toBe((131068).toLocaleString());
  });

  it('formats percentages to the requested precision', () => {
    expect(percent(3.14159, 1)).toBe('3.1%');
    expect(percent(3.14159, 0)).toBe('3%');
  });

  it('fixes decimals', () => {
    expect(decimal(2.449)).toBe('2.4');
  });
});

describe('large counts are scaled to the magnitude they actually are', () => {
  /**
   * The old code divided by a million and appended a literal "M". The live box
   * carries 82,562 domains, which rendered as "0.1M" - true, and reads as
   * "almost nothing".
   */
  it('shows a real gravity size in thousands, not as a fraction of a million', () => {
    expect(scaled(82562)).toEqual({ value: '82.6', unit: 'K' });
  });

  it('uses millions once there are millions', () => {
    expect(scaled(2_400_000)).toEqual({ value: '2.4', unit: 'M' });
  });

  it('leaves small counts alone', () => {
    expect(scaled(742)).toEqual({ value: '742', unit: '' });
  });
});
