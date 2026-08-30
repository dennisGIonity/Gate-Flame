import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {manualChunks} from './vite.chunks.config';
import {devBuildsPlugin} from './scripts/vite-dev-builds-plugin';

export default defineConfig(() => {
  // Opt-in only (VITE_DEV_NODE_PORT), for pointing `npm run dev` at a
  // node-agent running on a non-default local port — e.g. when 8080 is
  // already taken by something else on the same workstation. Proxying
  // server-side keeps the browser's own fetches same-origin, which matters
  // for embedded/sandboxed browser contexts that refuse cross-origin
  // requests outright regardless of the target's own CORS headers.
  const devNodePort = process.env.VITE_DEV_NODE_PORT;
  return {
    plugins: [react(), tailwindcss(), devBuildsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: devNodePort
        ? {
            '/api/v1': {
              target: `http://127.0.0.1:${devNodePort}`,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    build: {
      // Dropped from 2000. The old limit was set high enough that the 930 kB
      // single chunk never tripped it. 420 kB sits just above vendor-charts
      // (391 kB), the one deliberately large chunk — and it is async-only — so
      // anything new that grows past this is a genuine regression worth hearing
      // about rather than a known cost.
      chunkSizeWarningLimit: 420,
      rollupOptions: {
        output: {manualChunks},
      },
    },
  };
});
