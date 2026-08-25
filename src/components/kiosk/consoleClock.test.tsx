/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: clock cost
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The lock screen is what a wall panel displays by default - which means its
 * clock runs unattended for months at a time.
 *
 * It renders HH:MM. It used to re-arm every 1000 ms, so 59 of every 60 wakeups
 * did a setState, a React re-render and a reconcile to redraw a digit that had
 * not changed. On the 16 GB Pi 5 this is invisible. On the 2 GB Orange Pi Zero
 * 2W base model it is a core woken 86,400 times a day for nothing.
 *
 * These pin both halves of the fix, because each is easy to undo by accident:
 * the tick is per MINUTE, and it is aligned to the real minute boundary rather
 * than a drifting fixed interval. A wall clock that is visibly a minute late
 * undermines every other number on the screen.
 */

import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ConsoleLock from './ConsoleLock';
import type { ConsoleLockProps } from './ConsoleLock';

const props: ConsoleLockProps = {
  nodeId: 'GF-TEST',
  agentVersion: '0.1.0',
  protection: 'active',
  protectionDetail: null,
  reachable: true,
  refused: false,
  authority: 'console',
  verifyPin: null,
  onUnlock: () => {},
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the lock screen clock does not burn a core', () => {
  it('wakes about once a minute, not about once a second', () => {
    // THIS TEST MEASURES WAKEUPS, NOT TEXT.
    //
    // The first version of it compared the rendered string before and after 59
    // seconds and passed with the 1000 ms timer still in place - because the
    // clock reads 09:30 either way. It was asserting nothing. The cost being
    // removed here is the wakeup itself, so the wakeup is what gets counted.
    vi.setSystemTime(new Date('2026-08-25T09:30:00.000+02:00'));

    let scheduled = 0;
    const realTimeout = globalThis.setTimeout;
    const realInterval = globalThis.setInterval;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: never, ms?: number) => {
      // Count only sub-minute re-arms; React and testing-library schedule their
      // own microtask-ish timers that have nothing to do with the clock.
      if (typeof ms === 'number' && ms > 0 && ms <= 60_000) scheduled += 1;
      return realTimeout(fn, ms);
    }) as typeof globalThis.setTimeout);
    vi.spyOn(globalThis, 'setInterval').mockImplementation(((fn: never, ms?: number) => {
      if (typeof ms === 'number' && ms > 0 && ms <= 60_000) scheduled += 1;
      return realInterval(fn, ms);
    }) as typeof globalThis.setInterval);

    render(<ConsoleLock {...props} />);
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000); // one hour on the wall
    });

    // Once a minute re-arms ~60 times an hour. A 1000 ms interval arms once and
    // then fires 3600 times, so count its firings too via the elapsed budget:
    // either way, anything above ~90 means we are waking far too often.
    expect(scheduled).toBeLessThanOrEqual(90);
  });

  it('does not fire a sub-second timer at all', () => {
    vi.setSystemTime(new Date('2026-08-25T09:30:00.000+02:00'));
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(<ConsoleLock {...props} />);

    const subMinute = intervalSpy.mock.calls.filter(
      ([, ms]) => typeof ms === 'number' && ms > 0 && ms < 60_000,
    );
    expect(subMinute).toEqual([]);
  });

  it('does update when the minute actually rolls over', () => {
    vi.setSystemTime(new Date('2026-08-25T09:30:00.000+02:00'));
    render(<ConsoleLock {...props} />);
    expect(screen.getByText(/09:30/)).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(60_100);
    });
    expect(screen.getByText(/09:31/)).toBeTruthy();
  });

  it('aligns to the minute boundary instead of drifting', () => {
    // Mounted at 41.5 s past the minute. A fixed 60 s interval would then flip
    // the display at :41 of every following minute - wrong by 41 seconds, and
    // wrong in a way that gets noticed on a clock hanging on a wall.
    vi.setSystemTime(new Date('2026-08-25T09:30:41.500+02:00'));
    render(<ConsoleLock {...props} />);
    expect(screen.getByText(/09:30/)).toBeTruthy();

    // 18.5 s remain to the boundary. Just before it: still 09:30.
    act(() => {
      vi.advanceTimersByTime(18_000);
    });
    expect(screen.getByText(/09:30/)).toBeTruthy();

    // Cross it: 09:31, within a second of the real rollover.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByText(/09:31/)).toBeTruthy();
  });

  it('clears its timer on unmount', () => {
    vi.setSystemTime(new Date('2026-08-25T09:30:00.000+02:00'));
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(<ConsoleLock {...props} />);
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
