#!/usr/bin/env node
/**
 * Gate^Flame - run a Gradle task for the Android app, from any shell, and put
 * the artifact in release/.
 *
 *   node scripts/android-build.mjs assembleDebug     -> release/GateFlame-Mobile-debug.apk
 *   node scripts/android-build.mjs assembleRelease   -> release/GateFlame-Mobile.apk
 *   node scripts/android-build.mjs bundleRelease     -> release/GateFlame-Mobile.aab   (what Play takes)
 *
 * WHY THIS EXISTS
 *
 * `build:apk` and `build:apk-debug` used to be:
 *
 *     ... && cd android && chmod +x gradlew && ./gradlew assembleDebug && cd .. && cp ...
 *
 * npm on Windows runs scripts through cmd.exe - also when npm itself was started
 * from Git-bash - and cmd cannot run `chmod`, `./gradlew` or `cp`. The vite build
 * and `cap sync` earlier in the chain succeeded, so the output looked like a
 * build, and then:
 *
 *     '.' is not recognized as an internal or external command
 *
 * CLAUDE.md recorded this as "run it from Git-bash", which happened to work on
 * one machine where npm's script-shell had been changed. Re-hit 2026-10-03 from
 * Git-bash on wabakipi. Same class of defect as scripts/assemble-dist.mjs fixed
 * for the web bundles: Node is the one shell every machine here has.
 *
 * Gradle itself is the arbiter of signing: android/app/build.gradle refuses an
 * unsigned release build unless -PallowUnsignedRelease=true is passed through.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const androidDir = join(root, "android");
const releaseDir = join(root, "release");

const TASKS = {
  assembleDebug: {
    output: join("app", "build", "outputs", "apk", "debug", "app-debug.apk"),
    release: "GateFlame-Mobile-debug.apk",
  },
  assembleRelease: {
    output: join("app", "build", "outputs", "apk", "release", "app-release.apk"),
    release: "GateFlame-Mobile.apk",
  },
  bundleRelease: {
    output: join("app", "build", "outputs", "bundle", "release", "app-release.aab"),
    release: "GateFlame-Mobile.aab",
  },
};

const [task, ...extra] = process.argv.slice(2);
const spec = TASKS[task];
if (!spec) {
  console.error(`android-build: unknown task "${task ?? ""}". Expected one of: ${Object.keys(TASKS).join(", ")}`);
  process.exit(1);
}

// The web bundle must exist and must have been synced into the native project,
// or Gradle happily packages an empty app. Same guard assemble-dist.mjs applies
// one step earlier.
const synced = join(androidDir, "app", "src", "main", "assets", "public", "index.html");
if (!existsSync(synced)) {
  console.error(`android-build: ${synced} is missing. Run "npm run build:html-mobile && npx cap sync android" first.`);
  process.exit(1);
}

const isWindows = process.platform === "win32";
if (!isWindows) {
  // chmod +x, the portable way. Harmless when already set.
  const { chmodSync } = await import("node:fs");
  try {
    chmodSync(join(androidDir, "gradlew"), 0o755);
  } catch {
    /* a read-only checkout: Gradle will say so itself */
  }
}

// A .bat file needs cmd.exe to run it. Spawning cmd.exe explicitly with an
// argument ARRAY (rather than `shell: true`) keeps the arguments unescaped by
// nobody but us - Node warns about the shell option for exactly that reason.
const command = isWindows ? "cmd.exe" : "./gradlew";
const args = isWindows ? ["/d", "/s", "/c", "gradlew.bat", task, ...extra] : [task, ...extra];

console.log(`android-build: ${isWindows ? "gradlew.bat" : "./gradlew"} ${[task, ...extra].join(" ")}`);
const run = spawnSync(command, args, {
  cwd: androidDir,
  stdio: "inherit",
});
if (run.status !== 0) {
  console.error(`android-build: gradle exited with ${run.status ?? run.signal}`);
  process.exit(run.status ?? 1);
}

const built = join(androidDir, spec.output);
if (!existsSync(built)) {
  console.error(`android-build: gradle succeeded but ${built} does not exist`);
  process.exit(1);
}
mkdirSync(releaseDir, { recursive: true });
const target = join(releaseDir, spec.release);
copyFileSync(built, target);
const bytes = statSync(target).size;
console.log(`android-build: ${spec.release} (${(bytes / 1024 / 1024).toFixed(2)} MB) -> release/`);
