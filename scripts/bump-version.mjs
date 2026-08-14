#!/usr/bin/env node
/**
 * Gate^Flame — version bumper.
 *
 * android/version.properties is the single source of truth for the Android
 * app version. This script increments VERSION_CODE, and optionally sets a new
 * VERSION_NAME.
 *
 *   node scripts/bump-version.mjs                 +1 code, keep name
 *   node scripts/bump-version.mjs --name          +1 code, +1 semver patch
 *   node scripts/bump-version.mjs --name 2.0.0    +1 code, set name explicitly
 *   node scripts/bump-version.mjs --check         verify only, change nothing
 *
 * WHY THIS EXISTS
 * Android refuses to install an APK whose versionCode is <= the versionCode
 * already installed. versionCode was hardcoded to 1 and never moved, so the
 * first build shipped to a customer would have been the last one they could
 * ever take without uninstalling — and uninstalling wipes the node pairing.
 *
 * VERSION_CODE is monotonic and must never be reused or decreased. Once a
 * value has been signed and left this machine, it is burned forever.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const propsPath = join(here, '..', 'android', 'version.properties');

if (!existsSync(propsPath)) {
  console.error(`✗ ${propsPath} not found.`);
  console.error('  This file is the single source of truth for the app version.');
  process.exit(1);
}

const raw = readFileSync(propsPath, 'utf8');

const read = (key) => {
  const m = raw.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return m ? m[1].trim() : null;
};

const currentCode = Number.parseInt(read('VERSION_CODE') ?? '', 10);
const currentName = read('VERSION_NAME');

if (!Number.isInteger(currentCode) || currentCode < 1) {
  console.error(`✗ VERSION_CODE is missing or not a positive integer (got: ${read('VERSION_CODE')}).`);
  process.exit(1);
}
if (!currentName) {
  console.error('✗ VERSION_NAME is missing.');
  process.exit(1);
}

const argv = process.argv.slice(2);

if (argv.includes('--check')) {
  console.log(`versionCode=${currentCode} versionName=${currentName}`);
  process.exit(0);
}

const nextCode = currentCode + 1;

let nextName = currentName;
const nameIdx = argv.indexOf('--name');
if (nameIdx !== -1) {
  const explicit = argv[nameIdx + 1];
  if (explicit && !explicit.startsWith('--')) {
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(explicit)) {
      console.error(`✗ "${explicit}" is not a valid semver version name.`);
      process.exit(1);
    }
    nextName = explicit;
  } else {
    const parts = currentName.split('.').map((n) => Number.parseInt(n, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) {
      console.error(`✗ Cannot auto-increment "${currentName}" — not plain X.Y.Z.`);
      console.error('  Pass one explicitly: npm run version:release -- 1.1.0');
      process.exit(1);
    }
    parts[2] += 1;
    nextName = parts.join('.');
  }
}

const updated = raw
  .replace(/^VERSION_CODE=.*$/m, `VERSION_CODE=${nextCode}`)
  .replace(/^VERSION_NAME=.*$/m, `VERSION_NAME=${nextName}`);

writeFileSync(propsPath, updated, 'utf8');

console.log(`✓ versionCode ${currentCode} → ${nextCode}`);
if (nextName !== currentName) {
  console.log(`✓ versionName ${currentName} → ${nextName}`);
} else {
  console.log(`  versionName unchanged (${currentName})`);
}
console.log('  Commit android/version.properties with the build it produced.');
