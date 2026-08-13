#!/usr/bin/env node
/**
 * Gate^Flame — print the signing fingerprint and version of a built APK.
 *
 *   node scripts/apk-fingerprint.mjs [path/to.apk]
 *
 * Defaults to release/GateFlame-Mobile.apk.
 *
 * WHY THIS EXISTS
 * Two reasons, both of which bite after units ship:
 *
 * 1. The customer side-loads this APK from the kiosk's download page. Android
 *    will warn them, loudly, that it came from an unknown source. Publishing
 *    the SHA-256 certificate fingerprint next to the download link lets a
 *    security-conscious buyer verify they got the real thing. For a company
 *    selling a network security appliance, that is the difference between
 *    "trust us" and "check us".
 *
 * 2. It catches the fatal mistake early. If this fingerprint ever changes
 *    between releases, every device already in the field is stranded — Android
 *    will not update an app whose signing key changed. Run this on every
 *    release and compare against the previous one BEFORE distributing.
 *
 * Requires the Android SDK build-tools (apksigner) or a JDK (keytool) on PATH.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const apkPath = resolve(process.argv[2] ?? join(here, '..', 'release', 'GateFlame-Mobile.apk'));

if (!existsSync(apkPath)) {
  console.error(`✗ APK not found: ${apkPath}`);
  console.error('  Build one first:  npm run build:apk');
  process.exit(1);
}

const tryRun = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    return null;
  }
};

console.log(`APK: ${apkPath}`);

// Preferred: apksigner reports the signature scheme versions too.
const signerOut = tryRun('apksigner', ['verify', '--print-certs', '-v', apkPath]);

if (signerOut) {
  const sha256 = signerOut.match(/SHA-256 digest:\s*([0-9a-fA-F]+)/);
  const v1 = /\(JAR signing\).*?:\s*true/i.test(signerOut) || /v1 scheme.*?:\s*true/i.test(signerOut);
  const v2 = /v2 scheme.*?:\s*true/i.test(signerOut);
  const v3 = /v3 scheme.*?:\s*true/i.test(signerOut);

  if (sha256) {
    const pretty = sha256[1].toUpperCase().match(/.{2}/g).join(':');
    console.log(`\nSHA-256 certificate fingerprint:\n  ${pretty}`);
  }
  console.log(`\nSignature schemes:  v1=${v1}  v2=${v2}  v3=${v3}`);

  if (/DOES NOT VERIFY/i.test(signerOut)) {
    console.error('\n✗ APK DOES NOT VERIFY — do not distribute this build.');
    process.exit(1);
  }
  console.log('\n✓ Signature verifies.');
  console.log('  Publish this fingerprint beside the kiosk download link, and');
  console.log('  compare it against the previous release before shipping.');
  process.exit(0);
}

// Fallback: keytool can read the certificate straight out of the APK zip.
const keytoolOut = tryRun('keytool', ['-printcert', '-jarfile', apkPath]);
if (keytoolOut) {
  const sha256 = keytoolOut.match(/SHA256:\s*([0-9A-F:]+)/i);
  console.log(sha256 ? `\nSHA-256 certificate fingerprint:\n  ${sha256[1]}` : keytoolOut);
  console.log('\n  (apksigner not on PATH — install Android build-tools for scheme details.)');
  process.exit(0);
}

console.error('\n✗ Neither apksigner nor keytool is on PATH.');
console.error('  Install Android SDK build-tools, or a JDK, and re-run.');
process.exit(1);
