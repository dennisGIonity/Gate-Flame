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
    // BUG-02 (docs/FUNCTION-STATUS-AND-BUGS.md): 34 tests fail with
    // "React.act is not a function" when the shell's NODE_ENV is `production`
    // (true on wabakipi today - see CLAUDE.md's machine traps table), because
    // react-dom then loads its production build, which strips act(). CI
    // already works around this with an env: block in ci.yml; this is the
    // same fix for every local run, so a developer's shell can't reintroduce
    // it. `test.env` applies only inside the test process, same as CI's step.
    env: {
      NODE_ENV: 'test',
    },
  },
});
