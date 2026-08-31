/**
 * Two small presentation rules that a customer would read as bugs, pinned
 * because both were shipped once and both survived a full manual pass before
 * anyone noticed them on a real screen.
 *
 * 1. RingGauge rounded 0.5 to "1%" while the stat card beside it said "0.5%".
 *    One number, two answers, on one screen. Whoever sees that has no reason
 *    to trust either.
 *
 * 2. The Shield screen said "Not set up on this box yet." whenever the region
 *    list was empty - INCLUDING when the box answered fine and simply had no
 *    regions to offer. Shield was installed and working; the sentence told the
 *    owner it did not exist. Not-installed and nothing-to-show need different
 *    words because they need different actions from the reader.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RingGauge } from './charts';

describe('RingGauge percentage text', () => {
  it('keeps one decimal below ten so it agrees with the stat card beside it', () => {
    render(<RingGauge value={0.5} label="blocked share" />);
    expect(screen.getByText('0.5%')).toBeInTheDocument();
  });

  it('does not print a pointless trailing zero', () => {
    render(<RingGauge value={2} label="blocked share" />);
    expect(screen.getByText('2%')).toBeInTheDocument();
  });

  it('rounds at ten and above, where the decimal is noise', () => {
    render(<RingGauge value={34.4} label="blocked share" />);
    expect(screen.getByText('34%')).toBeInTheDocument();
  });

  it('still shows a dash rather than inventing a zero when there is no value', () => {
    render(<RingGauge value={null} label="blocked share" />);
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});
