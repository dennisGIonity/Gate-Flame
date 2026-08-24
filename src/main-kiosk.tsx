/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device display entry point
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The on-device display.
 *
 * This is the screen on the appliance itself: Chromium in --kiosk mode on the
 * Pi, pointed at http://localhost:8080/device-kiosk/ and served by node-agent's
 * static mount. It is NOT the thing doing the work - node-agent filters, meters
 * and enforces whether or not a screen is attached. Unplug the display and the
 * network stays protected. Keep it that way: nothing here may become
 * load-bearing, or a cracked screen becomes an unprotected house.
 *
 * WHAT THIS REPLACED
 *
 * Until 2026-08-16 this entry rendered DeviceOnboardingSimulator - 722 lines of
 * AI-Studio-era demo furniture that showed a "Select Network Uplink Source"
 * screen listing invented Wi-Fi networks (Home_Fiber_Optics_WiFi,
 * Grand_Hotel_Guest_WiFi) and a hardcoded `IP: 192.168.1.105` that was not even
 * on the deployed node's subnet. The agent has no Wi-Fi scanning endpoint and
 * never had one, so that screen could not have been real.
 *
 * GateFlameKiosk (2026-08-16) replaced it with one honest page: four regions,
 * no invented values, and no controls at all.
 *
 * KioskApp (2026-08-17) keeps that rule and adds back the reach the simulator
 * only pretended to have - a lock screen, then one tab per capability the agent
 * really has, each with its own telemetry, charts and controls. Every panel is
 * wired to a route in node-agent/gateflame/main.py; nothing is wired to
 * Math.random(). Unknown still renders as `-` plus the API's own `gap` string.
 *
 * GateFlameKiosk.tsx was deleted 2026-08-24, once KioskApp had run against the
 * live node on real hardware. It is in git history if it is ever wanted.
 *
 * THE PHONE APP IS BUILT ON THIS, NOT ALONGSIDE IT. The panels take a plain
 * PanelContext and know nothing about the surface they render on, so the phone
 * shares this app's data client, formatters and honesty rules rather than
 * carrying a second set that can drift. The first mobile app drifted exactly
 * that way and had to be scrapped.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './index.css';
import KioskApp from './components/kiosk/KioskApp';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('kiosk: #root not found in kiosk.html');
}

// The display is dark-only. It lives in a hallway or a cupboard, and a light
// theme on a wall-mounted panel at night is a lamp.
document.documentElement.classList.add('dark');

createRoot(rootEl).render(
  <StrictMode>
    <KioskApp />
  </StrictMode>,
);
