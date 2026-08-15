/**
 * Gate^Flame — global test setup.
 *
 * Only the things every suite needs. Anything test-specific belongs in the
 * test, not here — a setup file that silently changes behaviour is how a suite
 * ends up passing for reasons nobody can name.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom does not implement matchMedia, and several components consult it while
 * resolving `appTheme: 'system'`. Report "not dark" so those paths are
 * deterministic rather than throwing.
 */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

/** Recharts' ResponsiveContainer needs this; jsdom has no layout engine. */
if (!(globalThis as Record<string, unknown>).ResizeObserver) {
  (globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});
