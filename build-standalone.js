import { build } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  await build({
    configFile: path.resolve(__dirname, 'vite.standalone.config.ts'),
    build: {
      outDir: 'dist-standalone/mobile',
      emptyOutDir: true,
      rollupOptions: {
        input: { mobile: path.resolve(__dirname, 'mobile.html') }
      }
    }
  });

  await build({
    configFile: path.resolve(__dirname, 'vite.standalone.config.ts'),
    build: {
      outDir: 'dist-standalone/kiosk',
      emptyOutDir: true,
      rollupOptions: {
        input: { kiosk: path.resolve(__dirname, 'kiosk.html') }
      }
    }
  });
}
run();
