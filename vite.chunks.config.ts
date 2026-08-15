/**
 * Gate^Flame — shared rollup `manualChunks` rule.
 *
 * Not a vite config in its own right; it is imported by vite.config.ts and
 * vite.standalone.config.ts so the two builds cannot drift apart.
 *
 * Why these groups, measured against the 930 kB single-chunk build:
 *
 *   vendor-charts  ~415 kB  recharts + d3-* + decimal.js-light + es-toolkit +
 *                           the @reduxjs/toolkit store recharts 3 runs
 *                           internally. Reached only through dynamic imports
 *                           (DNSTrafficChart, ThreatCategoryChart,
 *                           DynamicModuleTab, DeviceOnboardingSimulator), so
 *                           this whole group is off the first-paint path.
 *   vendor-react   ~194 kB  react, react-dom, scheduler. Changes on a React
 *                           upgrade and essentially never otherwise, so it is
 *                           the most cacheable thing in the build.
 *   vendor-motion  ~130 kB  motion / motion-dom / framer-motion. Still eager:
 *                           AppLayout's nav indicator and MobileDashboard's
 *                           GlassPanel both animate on first paint.
 *   vendor-icons   ~23 kB   lucide-react.
 *   vendor-utils   ~30 kB   clsx, tailwind-merge, zustand.
 *
 * Anything else from node_modules lands in `vendor`. Splitting by group rather
 * than one chunk per package keeps the request count sane while still letting a
 * dependency bump invalidate only its own group.
 */

const GROUPS: Array<[RegExp, string]> = [
  [/node_modules\/(react|react-dom|scheduler|react-is|use-sync-external-store)\//, 'vendor-react'],
  [
    /node_modules\/(recharts|victory-vendor|d3-[a-z-]+|internmap|decimal\.js-light|es-toolkit|fast-equals|eventemitter3|@reduxjs|redux|redux-thunk|react-redux|reselect|immer)\//,
    'vendor-charts',
  ],
  [/node_modules\/(motion|motion-dom|motion-utils|framer-motion)\//, 'vendor-motion'],
  [/node_modules\/lucide-react\//, 'vendor-icons'],
  [/node_modules\/(clsx|tailwind-merge|zustand)\//, 'vendor-utils'],
];

export const manualChunks = (id: string): string | undefined => {
  // Normalise Windows separators so the patterns above hold on every host.
  const path = id.replace(/\\/g, '/');
  if (!path.includes('node_modules')) return undefined;
  for (const [pattern, name] of GROUPS) {
    if (pattern.test(path)) return name;
  }
  return 'vendor';
};
