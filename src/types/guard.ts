/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame API types: profiles, upstream, ML, storage
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * Typed by reading node-agent/gateflame/{profiles,upstream,anomaly,datadir}.py,
 * not by reading a description of them. Field names match the Python payloads
 * exactly; if the two ever disagree the kiosk silently stops being able to
 * read the box, so keep them in step.
 */

/* ---- /api/v1/profiles ------------------------------------------------- */

export type ProfileId = 'standard' | 'family' | 'strict' | 'focus';

export interface ProfilePreset {
  id: ProfileId;
  label: string;
  description: string;
  threatLevel: 'low' | 'medium' | 'high';
  categories: string[];
  threatLevelDescription: string;
  blocklistCount: number;
}

export interface ProfilesResponse {
  /** A preset id, or 'custom' when the live settings equal no preset. */
  active: ProfileId | 'custom';
  activeLabel: string;
  threatLevel: 'low' | 'medium' | 'high';
  categories: string[];
  appliedAt: number | null;
  appliedBy: string | null;
  presets: ProfilePreset[];
  storageWritable: boolean;
}

/* ---- /api/v1/profiles/accessibility ----------------------------------- */

export interface AccessibilityPrefs {
  reducedMotion: boolean;
  highContrast: boolean;
  /** 0.8–1.6 on the box; the phone clamps tighter. */
  textScale: number;
  verboseLabels: boolean;
  keepAwakeMinutes: number;
  updatedAt: number;
}

export interface AccessibilityResponse {
  prefs: AccessibilityPrefs;
  storageWritable?: boolean;
  persisted?: boolean;
}

/* ---- /api/v1/dns/upstream --------------------------------------------- */

export type UpstreamModeId = 'recursive' | 'cloudflare' | 'cloudflare-malware' | 'cloudflare-family';

export interface UpstreamMode {
  id: UpstreamModeId;
  label: string;
  description: string;
  upstreams: string[];
  operator: string;
  encrypted: boolean;
  filters: string[];
  isDefault: boolean;
}

export interface UpstreamApplyResult {
  requested: UpstreamModeId;
  before: string[] | null;
  ok: boolean;
  readBack: string[] | null;
  resolves: boolean | null;
  error: string | null;
  appliedBy: string | null;
  at: number;
}

export interface UpstreamResponse {
  /** false = Pi-hole did not answer; `mode` is then null, NOT 'recursive'. */
  reachable: boolean;
  mode: UpstreamModeId | 'custom' | null;
  upstreams: string[] | null;
  default: UpstreamModeId;
  encrypted: boolean | null;
  operator: string | null;
  modes: UpstreamMode[];
  lastApply: { mode: string | null; checkedAt: number | null; error: string | null };
  notice: string;
  applied?: UpstreamApplyResult;
}

/* ---- /api/v1/ml/anomalies ---------------------------------------------- */

export type AnomalyKind = 'dga_like_domain' | 'query_burst' | 'nxdomain_storm' | 'new_domain_spike';

export interface AnomalyFinding {
  kind: AnomalyKind;
  severity: 'low' | 'medium' | 'high';
  confidence: number;
  clientIp: string | null;
  domain: string | null;
  evidence: Record<string, unknown>;
  summary: string;
}

export interface AnomalyStats {
  queriesInWindow: number;
  distinctClients: number;
  windowSeconds: number;
  /** ADR-001: behind a forwarding router Pi-hole sees one address. */
  clientAttribution: 'per-device' | 'router-only';
  knownDomains: number;
  baselineRuns: number;
  baselinePersisted: boolean;
}

export interface AnomalyResponse {
  ranAt: number;
  source: 'pihole' | 'none';
  gap: string | null;
  findings: AnomalyFinding[];
  stats: AnomalyStats | null;
  model: { name: string; version: string; type: string; trainedOn: string } | null;
  notice: string;
}

/* ---- /api/v1/system/storage -------------------------------------------- */

export interface StorageSubdir {
  path: string;
  present: boolean;
  writable: boolean;
  files: number;
  bytes: number;
}

export interface StorageStatus {
  root: string;
  present: boolean;
  writable: boolean;
  subdirs: Record<string, StorageSubdir>;
  totalBytes: number;
  freeBytes: number | null;
  healthy: boolean;
}
