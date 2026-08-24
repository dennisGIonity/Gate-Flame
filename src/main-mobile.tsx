/**
 * Gate^Flame — phone app entry point.
 *
 * Everything lives in src/mobile/. This file exists only to mount it and to
 * force dark mode: the app has one palette, and a handset in light mode must
 * not get a half-inverted version of it.
 *
 * Until 2026-08-24 this rendered MobileDashboard — 800 lines of AI-Studio-era
 * demo furniture that drew a simulated phone bezel INSIDE the phone, kept its
 * own half-copy of the node client, and had drifted far enough from the console
 * that the two could disagree about the same network. It was replaced rather
 * than repaired: the console had already been rebuilt twice on that lesson, and
 * the mobile plan of 2026-08-17 specified this rebuild but sat untracked in a
 * scratch folder where nobody could see it.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import MobileApp from './mobile/MobileApp';

// One palette, always. The app is designed dark; `dark:` variants inherited
// from the old build would otherwise render a light-mode phone half-styled.
document.documentElement.classList.add('dark');

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('mobile: #root not found in mobile.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
