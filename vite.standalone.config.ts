import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path, { resolve } from 'path';
import { defineConfig } from 'vite';
import { manualChunks } from './vite.chunks.config';

/**
 * mobile.html + kiosk.html, emitted side by side into dist/ with a shared
 * assets/ directory. Despite the name this is *not* a single-file build — it
 * writes hashed chunks, and `build:html-mobile` / `build:html-kiosk` copy
 * dist/assets wholesale next to the renamed index.html. That is what makes
 * code-splitting safe here: a lazy chunk is just another file in assets/.
 *
 * The genuinely inlined single-file variants are vite.mobile.config.ts and
 * vite.kiosk.config.ts (vite-plugin-singlefile). They are not referenced by any
 * npm script and are left alone — see the note in vite.chunks.config.ts.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        mobile: resolve(__dirname, 'mobile.html'),
        kiosk: resolve(__dirname, 'kiosk.html'),
      },
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash].[ext]',
        manualChunks,
      },
    },
    chunkSizeWarningLimit: 420,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
