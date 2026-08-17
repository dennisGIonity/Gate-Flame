#!/usr/bin/env node
/**
 * Gate^Flame - assemble a surface bundle from the shared vite output.
 *
 * WHY THIS EXISTS
 *
 * `build:html-mobile` and `build:html-kiosk` were:
 *
 *     vite build ... && rm -rf dist-X && mkdir -p dist-X && cp -r ... && cp ...
 *
 * `rm`, `mkdir -p` and `cp` do not exist in Windows cmd. npm runs scripts
 * through cmd on Windows, so the vite step SUCCEEDED and the assembly step
 * died with "'rm' is not recognized" - leaving no dist-mobile/ and no
 * dist-kiosk/ at all, while the overall output still looked mostly like a
 * successful build.
 *
 * Consequences that were live before this file existed:
 *   - `npx cap sync android` syncs an empty/missing webDir, so the APK ships
 *     with no web content.
 *   - The kiosk bundle can never be produced on the machine that builds it.
 *
 * Node's fs is cross-platform, so the assembly is done here instead.
 *
 * Usage:  node scripts/assemble-dist.mjs mobile
 *         node scripts/assemble-dist.mjs kiosk
 */

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const SURFACES = {
  mobile: { html: "mobile.html", out: "dist-mobile" },
  kiosk: { html: "kiosk.html", out: "dist-kiosk" },
};

const surface = process.argv[2];
const spec = SURFACES[surface];

if (!spec) {
  console.error(
    `assemble-dist: unknown surface "${surface ?? ""}". Expected one of: ${Object.keys(SURFACES).join(", ")}`,
  );
  process.exit(1);
}

const root = resolve(process.cwd());
const dist = join(root, "dist");
const out = join(root, spec.out);
const srcHtml = join(dist, spec.html);
const srcAssets = join(dist, "assets");

// Fail loudly rather than producing a half-populated directory. A webDir that
// exists but has no index.html is the failure mode that makes `cap sync`
// succeed and the app load nothing.
if (!existsSync(srcHtml)) {
  console.error(`assemble-dist: ${srcHtml} not found. Did the vite build run?`);
  process.exit(1);
}
if (!existsSync(srcAssets)) {
  console.error(`assemble-dist: ${srcAssets} not found. Did the vite build run?`);
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(srcHtml, join(out, spec.html));
cpSync(srcAssets, join(out, "assets"), { recursive: true });

// The surface's entry point must be index.html: Capacitor's webDir and the
// node-agent's StaticFiles(html=True) mount both look for exactly that name.
cpSync(srcHtml, join(out, "index.html"));

if (!existsSync(join(out, "index.html"))) {
  console.error(`assemble-dist: ${out} has no index.html after assembly`);
  process.exit(1);
}

console.log(`assemble-dist: ${spec.out}/ ready (index.html + assets/)`);
