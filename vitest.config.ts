/**
 * Gate^Flame — test runner configuration.
 *
 * Separate from vite.config.ts on purpose: the build config now carries a
 * manualChunks layout and a chunk-size budget that have nothing to do with
 * running tests, and a `test` block wedged in beside them invites someone to
 * "tidy up" one and break the other.
 */

import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Each suite gets a clean module registry. gateflameApi and config/env hold
    // module-level state (the connection object, values frozen from
    // import.meta.env at import time), so leaking modules between files would
    // make results depend on file order.
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
