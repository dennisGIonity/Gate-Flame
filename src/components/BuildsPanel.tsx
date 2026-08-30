/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Builds panel
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Replaces ExportPackagingCenter (deleted): that panel "built" an APK by
 * generating a client-side HTML string with hardcoded numbers baked into it
 * and calling that a download. Nothing it offered ever ran a real build.
 *
 * This panel does three real things, each backed by scripts/vite-dev-builds-
 * plugin.ts (dev-server-only, never present in a shipped build):
 *
 *   1. Runs the ACTUAL npm build script (build:apk-debug / build:apk /
 *      build:html-kiosk) as a real subprocess.
 *   2. Shows the real stdout/stderr as it happens, not a decorative progress
 *      bar.
 *   3. Reports success only once the process has exited AND the expected
 *      output file is confirmed to exist on disk — never "done" from the
 *      exit code alone. Same "never claim success without a read-back" rule
 *      this project applies to Pi-hole writes (blocklists.py) and router
 *      settings (router_handshake.py), applied here to a build pipeline.
 *
 * Only reachable at all when the dev-builds endpoint answers — i.e. only
 * inside `npm run dev`, from the same machine the toolchain lives on. A
 * built/shipped copy of this app has nothing behind these buttons to call.
 */

import { useEffect, useRef, useState } from 'react';
import { Hammer, CheckCircle2, XCircle, Loader2, FileArchive } from 'lucide-react';

interface BuildTarget {
  id: 'mobile-debug' | 'mobile-release' | 'kiosk';
  label: string;
  description: string;
}

const TARGETS: BuildTarget[] = [
  {
    id: 'mobile-debug',
    label: 'Mobile — debug APK',
    description: 'npm run build:apk-debug → release/GateFlame-Mobile-debug.apk',
  },
  {
    id: 'mobile-release',
    label: 'Mobile — release APK',
    description: 'npm run build:apk → release/GateFlame-Mobile.apk (signed, if keystore is configured)',
  },
  {
    id: 'kiosk',
    label: 'Kiosk — web bundle',
    description: 'npm run build:html-kiosk → dist-kiosk/ (deploy to the box’s GATEFLAME_KIOSK_DIR)',
  },
];

interface StatusResponse {
  label: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  logTail: string[];
  outputFile: { exists: boolean; mtime: string | null; sizeBytes: number | null };
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function BuildCard({ target }: { target: BuildTarget }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/dev/builds/${target.id}/status`);
      if (!res.ok) {
        setError(`Dev build endpoint answered ${res.status} — this only works under \`npm run dev\`.`);
        return;
      }
      const data: StatusResponse = await res.json();
      setStatus(data);
      setError(null);
    } catch {
      setError('Cannot reach the dev build endpoint. This panel only works under `npm run dev`.');
    }
  };

  useEffect(() => {
    void fetchStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status?.running && !pollRef.current) {
      pollRef.current = setInterval(() => void fetchStatus(), 1500);
    } else if (!status?.running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.running]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [status?.logTail.length]);

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/builds/${target.id}/start`, { method: 'POST' });
      if (res.status === 409) {
        setError('Already running.');
      } else if (!res.ok) {
        setError(`Could not start (${res.status}).`);
      }
      await fetchStatus();
    } catch {
      setError('Cannot reach the dev build endpoint. This panel only works under `npm run dev`.');
    } finally {
      setStarting(false);
    }
  };

  // Success is ONLY the process exiting 0 AND the output file existing right
  // now, at read time — not the exit code alone. A build that exits 0 but
  // whose copy step failed silently must not read as done.
  const succeeded = status && !status.running && status.exitCode === 0 && status.outputFile.exists;
  const failed = status && !status.running && status.exitCode !== null && !succeeded;

  return (
    <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/60 dark:bg-black/30 backdrop-blur-xl p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">{target.label}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">{target.description}</p>
        </div>
        <button
          onClick={() => void start()}
          disabled={starting || status?.running}
          className="shrink-0 flex items-center gap-2 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium px-3.5 py-2 transition-colors"
        >
          {status?.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hammer className="w-4 h-4" />}
          {status?.running ? 'Building…' : 'Build'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-500">{error}</p>}

      {status && (
        <div className="flex items-center gap-4 text-xs">
          {succeeded && (
            <span className="flex items-center gap-1.5 text-emerald-500 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" /> Built — file confirmed on disk
            </span>
          )}
          {failed && (
            <span className="flex items-center gap-1.5 text-rose-500 font-medium">
              <XCircle className="w-3.5 h-3.5" />
              {status.outputFile.exists
                ? `Exit code ${status.exitCode} (output file still present from an earlier build — not proof of success)`
                : `Failed — exit code ${status.exitCode}, no output file`}
            </span>
          )}
          <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
            <FileArchive className="w-3.5 h-3.5" />
            {status.outputFile.exists
              ? `${fmtBytes(status.outputFile.sizeBytes)} · ${new Date(status.outputFile.mtime as string).toLocaleString('en-ZA')}`
              : 'no output file yet'}
          </span>
        </div>
      )}

      {status && status.logTail.length > 0 && (
        <pre className="max-h-56 overflow-y-auto rounded-lg bg-black/90 text-slate-300 text-[11px] font-mono p-3 leading-relaxed whitespace-pre-wrap">
          {status.logTail.join('\n')}
          <div ref={logEndRef} />
        </pre>
      )}
    </div>
  );
}

export const BuildsPanel: React.FC = () => {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          <Hammer className="w-5 h-5 text-sky-500" /> Builds
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Triggers the real build commands as real subprocesses on this machine. Only works under{' '}
          <code className="font-mono text-xs bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">npm run dev</code> —
          this is a local dev tool, never part of what ships to a customer box.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4">
        {TARGETS.map((t) => (
          <BuildCard key={t.id} target={t} />
        ))}
      </div>
    </div>
  );
};
