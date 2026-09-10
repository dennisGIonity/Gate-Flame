/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame pre-connection seeds
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

/**
 * What the store holds BEFORE a node has answered.
 *
 * Every value here is either `null` (meaning "not measured") or an empty
 * collection. Nothing is a plausible number. Until 2026-09-10 the seed was
 * 38 851 queries, 14 397 blocked, six named clients and seven named threat
 * rows — all invented — and the only thing separating them from real data was
 * a banner. Dennis's instruction was "actual only", so the placeholders are
 * gone: an app that has not heard from its node shows dashes, not fiction.
 *
 * `lib/format.ts` already renders `null` as "—", which is why these can be
 * null without any component change.
 */

import type { IonityUserAccount, SystemTelemetry } from '../types';

export const EMPTY_TELEMETRY: SystemTelemetry = {
  totalQueriesToday: null,
  queriesBlockedToday: null,
  blockPercentage: null,
  domainsOnGravity: null,
  activeClientsCount: null,
  dataSavedMB: null,
  avgLatencyMs: null,
  // 'initializing' rather than 'active': the app cannot know protection is
  // active until the node says so. The telemetry loop still polls in this
  // state (only 'paused' suppresses polling).
  protectionStatus: 'initializing',
  filterLevel: 'medium',
  pauseTimeRemainingSeconds: 0,
  uptimeSeconds: 0,
};

/**
 * An owner account with nothing filled in. The previous seed carried a real
 * personal e-mail address, a MAC address and a string that looked exactly like
 * a production API key. None of that belongs in a shipped bundle.
 */
export const DEFAULT_USER_ACCOUNT: IonityUserAccount = {
  email: '',
  companyName: '',
  subscriptionPlan: 'Standard Managed',
  subscriptionActive: false,
  warrantyValidUntil: '',
  linkedDeviceMac: '',
  deviceNickname: '',
  apiKey: '',
  syncStatus: 'offline',
  lastSyncTimestamp: '',
  appTheme: 'system',
};
