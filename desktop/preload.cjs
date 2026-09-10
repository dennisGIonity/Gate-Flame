/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame desktop console (preload)
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 *
 * Exposes exactly one read-only fact to the web app: that it is running inside
 * the desktop shell, and which platform. Nothing else crosses the bridge — the
 * renderer has no Node, no IPC to the filesystem, no way to reach anything the
 * phone build could not reach.
 */

'use strict';

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('gateflameDesktop', Object.freeze({
  surface: 'desktop',
  platform: process.platform,
}));
