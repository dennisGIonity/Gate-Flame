/* ========================================================================================
 * GATE^FLAME - ACCESSIBILITY SETTINGS APPLY AT LAUNCH, AND "REDUCE MOTION" STOPS MOTION
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * Two findings from the 2026-10-02 mobile pass:
 *
 *  - The phone's saved accessibility prefs were only applied by the hook inside the
 *    Settings card, so on launch a 130% text size or high contrast did nothing until
 *    the owner scrolled to the card that set it. `applyCachedAccessibility` runs at
 *    the entry point.
 *  - `useReducedMotion` (which every canvas, ring and counting figure consults) read
 *    only the OS media query. The in-app "Reduce motion" switch sets `html.reduce-motion`
 *    and stopped the CSS, but the canvases kept drifting. The hook now watches the class.
 * ======================================================================================== */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { A11Y_CACHE_KEY } from '../components/brand/Splash';
import { useReducedMotion } from '../components/kiosk/charts';
import { PHONE_TEXT_SCALE, applyCachedAccessibility } from './useAccessibility';

afterEach(() => {
  const root = document.documentElement;
  root.style.fontSize = '';
  root.classList.remove('reduce-motion', 'high-contrast', 'verbose-labels');
});

describe('applyCachedAccessibility', () => {
  it('applies a saved text scale, contrast and motion preference to <html> without any component mounted', () => {
    localStorage.setItem(
      A11Y_CACHE_KEY,
      JSON.stringify({ textScale: 1.3, highContrast: true, reducedMotion: true, verboseLabels: false }),
    );

    applyCachedAccessibility(PHONE_TEXT_SCALE);

    const root = document.documentElement;
    expect(root.style.fontSize).toBe('20.8px'); // 16 × 1.3
    expect(root.classList.contains('high-contrast')).toBe(true);
    expect(root.classList.contains('reduce-motion')).toBe(true);
    expect(root.classList.contains('verbose-labels')).toBe(false);
  });

  it('clamps to the phone’s own range, same as the Settings card does', () => {
    localStorage.setItem(A11Y_CACHE_KEY, JSON.stringify({ textScale: 3 }));
    applyCachedAccessibility(PHONE_TEXT_SCALE);
    expect(document.documentElement.style.fontSize).toBe(`${16 * PHONE_TEXT_SCALE.scaleMax}px`);
  });

  it('with nothing saved, leaves the defaults: 16px, no classes', () => {
    applyCachedAccessibility(PHONE_TEXT_SCALE);
    const root = document.documentElement;
    expect(root.style.fontSize).toBe('16px');
    expect(root.classList.contains('high-contrast')).toBe(false);
    expect(root.classList.contains('reduce-motion')).toBe(false);
  });

  it('survives a corrupt cache rather than throwing before the first paint', () => {
    localStorage.setItem(A11Y_CACHE_KEY, '{not json');
    expect(() => applyCachedAccessibility(PHONE_TEXT_SCALE)).not.toThrow();
    expect(document.documentElement.style.fontSize).toBe('16px');
  });
});

describe('useReducedMotion honours the owner’s in-app switch, not only the OS', () => {
  it('is false by default in this environment', () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('is true when html.reduce-motion is already present at mount', () => {
    document.documentElement.classList.add('reduce-motion');
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it('follows the class as it is toggled, without a reload', async () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);

    await act(async () => {
      document.documentElement.classList.add('reduce-motion');
      await Promise.resolve(); // MutationObserver callbacks run as microtasks
    });
    expect(result.current).toBe(true);

    await act(async () => {
      document.documentElement.classList.remove('reduce-motion');
      await Promise.resolve();
    });
    expect(result.current).toBe(false);
  });
});
