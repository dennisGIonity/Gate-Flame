#!/usr/bin/env node
/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame: build-output guard
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Fail the build if it produced a React DEVELOPMENT bundle.
 *
 * WHY THIS EXISTS
 *
 * This defect has now shipped three times, on two different machines, and it is
 * invisible: a dev bundle installs, launches, and behaves correctly. It is
 * roughly twice the size, materially slower, and it leaks component names,
 * prop-types warnings and internal React state into a customer's device.
 * Nothing about running the app reveals it.
 *
 * The trap is subtle enough to be worth writing down precisely, because the
 * mechanism is ONE CHARACTER and it is invisible in a terminal.
 *
 * On the Windows build machine `NODE_ENV` is set to `production` machine-wide,
 * which breaks `npm ci` (it silently omits devDependencies), so the documented
 * workaround has been to clear it first. In cmd, `set VAR=value` takes
 * everything up to the line break as the value — INCLUDING TRAILING SPACES.
 * Measured on this machine, 2026-08-25:
 *
 *   set NODE_ENV= && npm run build:html-mobile     NODE_ENV = " "  → 382 kB DEV
 *   set NODE_ENV=&& npm run build:html-mobile      NODE_ENV unset  → 189 kB prod
 *   set NODE_ENV=production&& npm run ...          NODE_ENV = prod → 189 kB prod
 *
 * The first form is the one written in the project's own notes. A single space
 * before the `&&` assigns `" "`, which is not `production`, so Node resolves
 * React's `development` export condition and Vite bundles the development build
 * into a production artifact — with no warning, at double the size.
 *
 * Nobody is going to remember that, and nobody can see it. This script means
 * they do not have to: the build fails loudly instead of quietly shipping the
 * wrong artifact.
 *
 * Detection is by CONTENT, not by file size. Size is a proxy that drifts every
 * time React changes; the presence of a development-only warning string is
 * proof. `Minified React error` appears only in production builds (it is the
 * message pointing at the error-decoder page), and the `key` prop warning
 * appears only in development ones — so the two checks corroborate each other
 * and a single false reading cannot pass the gate on its own.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'dist/assets';

/** Present ONLY in a development build. */
const DEV_MARKERS = ['unique "key" prop', 'Warning: Each child in a list'];
/** Present ONLY in a production build. */
const PROD_MARKER = 'Minified React error';

let files;
try {
  files = readdirSync(dir).filter((f) => /^vendor-react\..*\.js$/.test(f));
} catch (err) {
  console.error(`verify-bundle: cannot read ${dir} — ${err.message}`);
  process.exit(1);
}

if (files.length === 0) {
  // Not "probably fine". A missing vendor chunk means the chunking config
  // changed and this guard stopped guarding anything — which is exactly how a
  // check quietly becomes decorative.
  console.error(
    `verify-bundle: no vendor-react chunk in ${dir}.\n` +
      '  The manualChunks config may have changed. This guard is now checking nothing,\n' +
      '  so it fails rather than passing on an assumption.',
  );
  process.exit(1);
}

let failed = false;

for (const file of files) {
  const path = join(dir, file);
  const src = readFileSync(path, 'utf8');
  const dev = DEV_MARKERS.some((m) => src.includes(m));
  const prod = src.includes(PROD_MARKER);
  const kb = (Buffer.byteLength(src) / 1024).toFixed(1);

  if (dev || !prod) {
    failed = true;
    console.error(
      `\nverify-bundle: ${file} is a REACT DEVELOPMENT BUILD (${kb} kB).\n` +
        `  development markers: ${dev ? 'present' : 'absent'}\n` +
        `  production marker:   ${prod ? 'present' : 'absent'}\n\n` +
        '  It is ~2x the size, slower, and leaks internals into a customer device.\n' +
        '  Rebuild with NODE_ENV set to exactly "production":\n\n' +
        '    cmd:        set NODE_ENV=production&& npm run build:html-mobile\n' +
        '    PowerShell: $env:NODE_ENV="production"; npm run build:html-mobile\n' +
        '    bash:       NODE_ENV=production npm run build:html-mobile\n\n' +
        '  MIND THE SPACE. In cmd, `set NODE_ENV= && ...` assigns a single SPACE,\n' +
        '  which is not "production" — that one character is what produced this\n' +
        '  bundle. `set NODE_ENV=&& ...` (no space) genuinely clears it.\n',
    );
  } else {
    console.log(`verify-bundle: ${file} is a production build (${kb} kB) — ok`);
  }
}

process.exit(failed ? 1 : 0);
