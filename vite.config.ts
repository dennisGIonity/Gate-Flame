import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {manualChunks} from './vite.chunks.config';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
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
