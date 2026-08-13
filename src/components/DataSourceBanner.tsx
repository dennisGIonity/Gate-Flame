/**
 * Gate^Flame — data source banner.
 *
 * The honesty surface. When the app is showing simulated data, this says so,
 * unmissably, at the top of every view.
 *
 * Before this existed, nine feature cards rendered numbers fabricated by
 * Math.random() with nothing to distinguish them from real telemetry. For a
 * demo that is fine. For a product sold as network security it is not, and the
 * distinction has to be visible rather than documented.
 *
 * Deliberately not dismissible while in demo mode. A banner the user can close
 * is a banner that is closed during the one screenshot that matters.
 */

import React from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { useConnection } from '../hooks/useConnection';

export const DataSourceBanner: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { dataSource, nodeName, nodeId, agentVersion, lastError, mockForced, reconnect } =
    useConnection();

  if (dataSource === 'live') {
    if (compact) return null;
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 text-[10px] font-mono text-emerald-700 dark:text-emerald-300"
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">
          LIVE — {nodeName ?? 'Gate^Flame node'}
          {nodeId ? ` · ${nodeId}` : ''}
          {agentVersion ? ` · agent ${agentVersion}` : ''}
        </span>
      </div>
    );
  }

  if (dataSource === 'connecting') {
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-blue-900/20 border border-slate-200 dark:border-blue-500/30 text-[10px] font-mono text-slate-600 dark:text-blue-300"
      >
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
        <span>Looking for a Gate^Flame node on this network…</span>
      </div>
    );
  }

  if (dataSource === 'error') {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-500/40 text-[10px] font-mono text-red-800 dark:text-red-300"
      >
        <WifiOff className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-bold tracking-wider">NOT CONNECTED</div>
          <div className="mt-0.5 opacity-90 break-words">{lastError ?? 'No node reachable.'}</div>
        </div>
        <button
          type="button"
          onClick={reconnect}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-red-400/50 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  // dataSource === 'demo'
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-500/50 text-[10px] font-mono text-amber-900 dark:text-amber-200"
    >
      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="font-bold tracking-wider">SIMULATED DATA — NOT YOUR NETWORK</div>
        <div className="mt-0.5 opacity-90 break-words">
          {mockForced
            ? 'Demo mode is switched on. Every figure below is generated, and no setting here changes anything on a real network.'
            : `No node connected${lastError ? ` — ${lastError}` : '.'} Every figure below is generated.`}
        </div>
      </div>
      {!mockForced && (
        <button
          type="button"
          onClick={reconnect}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-amber-500/50 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      )}
    </div>
  );
};

/** Small inline marker for individual cards and tiles. */
export const SimulatedBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { dataSource } = useConnection();
  if (dataSource !== 'demo') return null;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-400/60 bg-amber-100/80 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 text-[8px] font-mono tracking-wider uppercase ${className}`}
      title="This value is generated, not measured from your network."
    >
      <AlertTriangle className="w-2.5 h-2.5" />
      Simulated
    </span>
  );
};
