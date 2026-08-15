/**
 * Gate^Flame — Suspense fallbacks for code-split surfaces.
 *
 * Everything below the dashboard's critical path is loaded with React.lazy().
 * That means there is a real, visible gap between "the user clicked" and "the
 * chunk arrived", and a blank rectangle during that gap reads as a broken
 * panel rather than a loading one.
 *
 * These fallbacks deliberately reuse the app's existing vocabulary — the
 * `.glass-panel` utility from src/index.css, the spinning `Loader2` and the
 * tiny uppercase mono caption already used by DataSourceBanner's `connecting`
 * state — so a loading panel looks like this product, not like a spinner
 * someone bolted on.
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * Panel-sized fallback. Stands in for a whole view or tab, so it carries the
 * same rounded glass shell the real panel will have and does not collapse the
 * layout when it swaps out.
 */
export const PanelFallback: React.FC<{ label?: string; className?: string }> = ({
  label = 'Loading module',
  className = '',
}) => (
  <div
    role="status"
    aria-live="polite"
    className={`glass-panel rounded-3xl w-full h-full min-h-[240px] flex flex-col items-center justify-center gap-3 ${className}`}
  >
    <Loader2 className="w-5 h-5 shrink-0 text-sky-500 dark:text-sky-400 animate-spin" />
    <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 dark:text-slate-400">
      {label}…
    </span>
  </div>
);

/**
 * Fallback for something loading *inside* an existing panel — a chart, a
 * canvas. No shell of its own: the panel around it already drew one.
 */
export const InlineFallback: React.FC<{ label?: string; className?: string }> = ({
  label = 'Loading',
  className = '',
}) => (
  <div
    role="status"
    aria-live="polite"
    className={`flex h-full w-full items-center justify-center gap-2 ${className}`}
  >
    <Loader2 className="w-3.5 h-3.5 shrink-0 text-sky-500 dark:text-sky-400 animate-spin" />
    <span className="text-[9px] font-mono uppercase tracking-widest text-slate-400 dark:text-slate-500">
      {label}…
    </span>
  </div>
);
