/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame accessibility preferences
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Applies accessibility preferences to the document and keeps a local cache.
 *
 * Source of truth differs by surface, and the hook is told which:
 *   kiosk  — the box (`/profiles/accessibility`), so a wall panel remembers
 *            its settings across a reboot with no browser profile to rely on.
 *   phone / desktop — local (this device's own storage). A person's phone is
 *            theirs; the wall panel's settings are the household's.
 *
 * Whatever the source, the effect is the same three things on <html>:
 *   style.fontSize        = 16px × textScale
 *   class "high-contrast" when highContrast
 *   class "reduce-motion" when reducedMotion  (CSS in index.css kills
 *                          animations/transitions under it)
 * plus the `gateflame-a11y` cache the Splash reads before React has data.
 */

import { useCallback, useEffect, useState } from 'react';
import { A11Y_CACHE_KEY } from '../components/brand/Splash';
import type { AccessibilityPrefs } from '../types/guard';

export const A11Y_DEFAULTS: AccessibilityPrefs = {
  reducedMotion: false,
  highContrast: false,
  textScale: 1.0,
  verboseLabels: false,
  keepAwakeMinutes: 0,
  updatedAt: 0,
};

const readCache = (): AccessibilityPrefs => {
  try {
    const raw = window.localStorage.getItem(A11Y_CACHE_KEY);
    if (raw) return { ...A11Y_DEFAULTS, ...(JSON.parse(raw) as Partial<AccessibilityPrefs>) };
  } catch {
    /* blocked storage: defaults */
  }
  return A11Y_DEFAULTS;
};

const writeCache = (p: AccessibilityPrefs): void => {
  try {
    window.localStorage.setItem(A11Y_CACHE_KEY, JSON.stringify(p));
  } catch {
    /* fine */
  }
};

/** Apply to the document. Exported so a test can assert the DOM effect. */
export function applyAccessibility(p: AccessibilityPrefs, scaleMin = 0.8, scaleMax = 1.6): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const scale = Math.min(scaleMax, Math.max(scaleMin, p.textScale || 1));
  root.style.fontSize = `${Math.round(16 * scale * 100) / 100}px`;
  root.classList.toggle('high-contrast', !!p.highContrast);
  root.classList.toggle('reduce-motion', !!p.reducedMotion);
  root.classList.toggle('verbose-labels', !!p.verboseLabels);
}

/**
 * @param remote  when given (kiosk), the box's prefs win and the cache mirrors
 *                them; when omitted (phone), the cache is the store.
 */
export function useAccessibility(remote?: AccessibilityPrefs | null, opts?: { scaleMin?: number; scaleMax?: number }) {
  const [prefs, setPrefs] = useState<AccessibilityPrefs>(readCache);

  useEffect(() => {
    if (remote) {
      setPrefs(remote);
      writeCache(remote);
    }
  }, [remote]);

  useEffect(() => {
    applyAccessibility(prefs, opts?.scaleMin, opts?.scaleMax);
  }, [prefs, opts?.scaleMin, opts?.scaleMax]);

  const update = useCallback((patch: Partial<AccessibilityPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch, updatedAt: Date.now() / 1000 };
      writeCache(next);
      return next;
    });
  }, []);

  return { prefs, update };
}
