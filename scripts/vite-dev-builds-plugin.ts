/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — dev-only build trigger for the "Builds" panel
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Replaces ExportPackagingCenter.tsx (deleted), which "built" an APK by
 * generating a client-side HTML string with hardcoded numbers baked into it
 * ("38,851 queries", "Shield Active") and calling that a download. Nothing it
 * offered ever ran a real build.
 *
 * This is the real thing: `apply: 'serve'` means it exists ONLY inside
 * `vite dev` and is entirely absent from `vite build` output — it must never
 * ship to a customer box, because it shells out to whatever the request asks
 * for. Loopback-only for the same reason node-agent's kiosk scope is
 * loopback-only (security.py): `npm run dev` binds 0.0.0.0, so without this
 * check anyone on the LAN could trigger an arbitrary npm script on this
 * workstation, not just the person sitting at it.
 *
 * No fabricated "build succeeded". A job is only ever reported done once the
 * child process has actually exited, and the status response re-checks the
 * expected output file on disk (exists / mtime / size) rather than trusting
 * the exit code alone — the project's "never claim success without a
 * read-back" rule, applied to a build pipeline instead of a network write.
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {existsSync, statSync} from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';

export interface BuildTargetDef {
  /** npm script name from package.json, e.g. "build:apk-debug". */
  script: string;
  /** Where the finished artifact should land, relative to the repo root. */
  outputFile: string;
  label: string;
}

export const BUILD_TARGETS: Record<string, BuildTargetDef> = {
  'mobile-debug': {
    script: 'build:apk-debug',
    outputFile: 'release/GateFlame-Mobile-debug.apk',
    label: 'Mobile — debug APK',
  },
  'mobile-release': {
    script: 'build:apk',
    outputFile: 'release/GateFlame-Mobile.apk',
    label: 'Mobile — release APK',
  },
  kiosk: {
    script: 'build:html-kiosk',
    outputFile: 'dist-kiosk/index.html',
    label: 'Kiosk — web bundle',
  },
};

interface BuildJob {
  proc: ChildProcess | null;
  log: string[];
  startedAt: number;
  finishedAt: number | null;
  exitCode: number | null;
  running: boolean;
}

const MAX_LOG_LINES = 2000;
const LOG_TAIL_LINES = 300;

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace('::ffff:', '');
  return a === '127.0.0.1' || a === '::1' || a === 'localhost';
}

export function devBuildsPlugin(): Plugin {
  const jobs = new Map<string, BuildJob>();

  return {
    name: 'gateflame-dev-builds',
    // Never present in `vite build` output — dev-only tooling, by construction.
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/dev/builds/')) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json');

        if (!isLoopback(req.socket.remoteAddress)) {
          res.statusCode = 403;
          res.end(JSON.stringify({error: 'loopback_only'}));
          return;
        }

        const url = new URL(req.url, 'http://localhost');
        const parts = url.pathname.split('/').filter(Boolean); // ['api','dev','builds', target, action]
        const target = parts[3];
        const action = parts[4];
        const def = target ? BUILD_TARGETS[target] : undefined;

        if (!def) {
          res.statusCode = 404;
          res.end(JSON.stringify({error: 'unknown_target', targets: Object.keys(BUILD_TARGETS)}));
          return;
        }

        if (req.method === 'POST' && action === 'start') {
          const existing = jobs.get(target);
          if (existing?.running) {
            res.statusCode = 409;
            res.end(JSON.stringify({error: 'already_running'}));
            return;
          }

          const job: BuildJob = {
            proc: null,
            log: [],
            startedAt: Date.now(),
            finishedAt: null,
            exitCode: null,
            running: true,
          };
          jobs.set(target, job);

          const isWin = process.platform === 'win32';
          const proc = spawn(isWin ? 'npm.cmd' : 'npm', ['run', def.script], {
            cwd: process.cwd(),
          });
          job.proc = proc;

          const push = (buf: Buffer) => {
            for (const line of buf.toString('utf-8').split(/\r?\n/)) {
              if (line.length === 0) continue;
              job.log.push(line);
            }
            if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
          };
          proc.stdout?.on('data', push);
          proc.stderr?.on('data', push);
          proc.on('close', (code) => {
            job.exitCode = code;
            job.running = false;
            job.finishedAt = Date.now();
          });
          proc.on('error', (err) => {
            job.log.push(`[spawn error] ${err.message}`);
            job.exitCode = -1;
            job.running = false;
            job.finishedAt = Date.now();
          });

          res.statusCode = 202;
          res.end(JSON.stringify({ok: true, started: true}));
          return;
        }

        if (req.method === 'GET' && action === 'status') {
          const job = jobs.get(target);
          const outPath = path.resolve(process.cwd(), def.outputFile);
          const outputFile = existsSync(outPath)
            ? {exists: true, mtime: statSync(outPath).mtime.toISOString(), sizeBytes: statSync(outPath).size}
            : {exists: false, mtime: null, sizeBytes: null};

          res.statusCode = 200;
          res.end(
            JSON.stringify({
              label: def.label,
              running: job?.running ?? false,
              exitCode: job?.exitCode ?? null,
              startedAt: job?.startedAt ?? null,
              finishedAt: job?.finishedAt ?? null,
              logTail: job ? job.log.slice(-LOG_TAIL_LINES) : [],
              outputFile,
            }),
          );
          return;
        }

        res.statusCode = 405;
        res.end(JSON.stringify({error: 'method_not_allowed'}));
      });
    },
  };
}
