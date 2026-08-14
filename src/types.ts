/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame Security Node Types
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

export type HardwareTierId = 'tier1_mini' | 'tier2_wired' | 'tier3_visual' | 'tier4_ai';

export interface HardwareTierInfo {
  id: HardwareTierId;
  name: string;
  subtitle: string;
  targetMarket: string;
  baseCostZAR: number;
  retailPriceZAR: number;
  cpu: string;
  ram: string;
  qps: number;
  maxClients: number;
  cooling: string;
  display: string;
  badgeColor: string;
}

export type NetworkInterfaceType = 'ethernet' | 'wifi';

export interface NetworkOption {
  id: string;
  ssid: string;
  type: NetworkInterfaceType;
  signalStrength?: number; // percentage for Wi-Fi
  secured: boolean;
  frequency?: string;
  ipAddress?: string;
}

export interface SystemTelemetry {
  totalQueriesToday: number;
  queriesBlockedToday: number;
  blockPercentage: number;
  domainsOnGravity: number;
  activeClientsCount: number;
  dataSavedMB: number;
  avgLatencyMs: number;
  protectionStatus: 'active' | 'paused' | 'initializing' | 'failover_hotspot';
  filterLevel: 'none' | 'low' | 'medium' | 'high';
  pauseTimeRemainingSeconds: number;
  uptimeSeconds: number;
}

export interface ThreatLogEntry {
  id: string;
  timestamp: string;
  domain: string;
  clientIp: string;
  clientName: string;
  category: 'Telemetry' | 'Malware' | 'Ad Tracker' | 'Phishing' | 'Adult / Gambling' | 'Cryptojacking';
  action: 'Blocked' | 'Whitelisted' | 'Forwarded';
  severity: 'high' | 'medium' | 'low';
}

export interface ConnectedClient {
  ip: string;
  mac: string;
  hostname: string;
  deviceType: 'TV' | 'Smartphone' | 'Laptop' | 'IoT' | 'Gaming Console' | 'Server';
  queriesToday: number;
  blockedToday: number;
  lastActive: string;
}

export type AppTheme = 'light' | 'dark' | 'system';

export interface IonityUserAccount {
  email: string;
  companyName: string;
  subscriptionPlan: 'Standard Managed' | 'Enterprise SLA';
  subscriptionActive: boolean;
  warrantyValidUntil: string;
  linkedDeviceMac: string;
  deviceNickname: string;
  apiKey: string;
  syncStatus: 'synced' | 'syncing' | 'offline';
  lastSyncTimestamp: string;
  appTheme: AppTheme;
}

export type AppViewMode = 'mobile_apk' | 'device_kiosk' | 'server_sync' | 'container_architecture' | 'scripts_bom' | 'future_roadmap' | 'package_export';

export interface ContainerSpec {
  id: string;
  name: string;
  role: string;
  baseImage: string;
  ramUsageMB: number;
  cpuUsagePercent: number;
  ports: string[];
  volumeMounts: string[];
  status: 'running' | 'degraded' | 'restarting';
  description: string;
}

export interface FutureFeatureModule {
  id: string;
  name: string;
  category: 'AI & Intelligence' | 'Network Security' | 'Hospitality SCADA' | 'Travel & Failover' | 'Enterprise Hardware';
  status: 'planned_later' | 'in_preview' | 'active';
  description: string;
  targetHardware: string;
  enabledLater: boolean;
  docReference: string;
}

export type OnboardingStep = 
  | 'power_on'
  | 'welcome_greeting'
  | 'network_selection'
  | 'network_auth'
  | 'user_auth'
  | 'initializing'
  | 'infographic_kiosk';
