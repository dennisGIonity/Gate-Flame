/**
 * Splash + accessibility: the two things that must hold on a wall panel.
 *
 *  - reduced motion (OS or cached pref) means a static splash and a fast exit
 *  - the splash hands over on a timer, never on an animation event
 *  - applyAccessibility changes <html> exactly as index.css expects
 */

import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { A11Y_CACHE_KEY, Splash, prefersReducedMotion } from './Splash';
import { applyAccessibility, A11Y_DEFAULTS } from '../../hooks/useAccessibility';

const matchMedia = (matches: boolean) =>
  vi.fn().mockImplementation((q: string) => ({ matches, media: q, addEventListener() {}, removeEventListener() {} }));

describe('Splash', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.stubGlobal('matchMedia', matchMedia(false));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('animates by default and hands over after ~2 s on a timer', () => {
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    expect(container.querySelector('.gf-splash--static')).toBeNull();
    act(() => vi.advanceTimersByTime(1500));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('OS reduced-motion → static splash, done in 400 ms', () => {
    vi.stubGlobal('matchMedia', matchMedia(true));
    const onDone = vi.fn();
    const { container } = render(<Splash onDone={onDone} />);
    expect(container.querySelector('.gf-splash--static')).not.toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('the cached accessibility pref alone is enough to go static', () => {
    localStorage.setItem(A11Y_CACHE_KEY, JSON.stringify({ reducedMotion: true }));
    expect(prefersReducedMotion()).toBe(true);
    const { container } = render(<Splash onDone={() => {}} />);
    expect(container.querySelector('.gf-splash--static')).not.toBeNull();
  });

  it('names the product and the tagline, not a placeholder', () => {
    const { getByText } = render(<Splash onDone={() => {}} />);
    expect(getByText('Building Tomorrow, Today.')).toBeTruthy();
  });
});

describe('applyAccessibility', () => {
  afterEach(() => {
    document.documentElement.style.fontSize = '';
    document.documentElement.className = '';
  });

  it('scales the root font and toggles the classes index.css keys off', () => {
    applyAccessibility({ ...A11Y_DEFAULTS, textScale: 1.25, highContrast: true, reducedMotion: true });
    const html = document.documentElement;
    expect(html.style.fontSize).toBe('20px');
    expect(html.classList.contains('high-contrast')).toBe(true);
    expect(html.classList.contains('reduce-motion')).toBe(true);
  });

  it('clamps the scale to the surface bounds', () => {
    applyAccessibility({ ...A11Y_DEFAULTS, textScale: 9 }, 0.9, 1.4);
    expect(document.documentElement.style.fontSize).toBe('22.4px');
    applyAccessibility({ ...A11Y_DEFAULTS, textScale: 0.1 }, 0.9, 1.4);
    expect(document.documentElement.style.fontSize).toBe('14.4px');
  });
});
