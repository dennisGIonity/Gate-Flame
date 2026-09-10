/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame product catalogue
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

/**
 * The hardware tiers Ionity actually sells, with real BOM and retail pricing in
 * ZAR. This is product data, not telemetry: nothing here is measured from a
 * network, so nothing here can be "simulated". Moved out of the former
 * mockData.ts on 2026-09-10 when every fabricated figure was removed.
 */

import type { HardwareTierInfo } from '../types';

export const HARDWARE_TIERS: HardwareTierInfo[] = [
  {
    id: 'tier1_mini',
    name: 'Device 1: Minimalist Node',
    subtitle: 'Pocket-Sized Privacy & Travel Security',
    targetMarket: 'Travelers, Small Apartments, Headless Stealth',
    baseCostZAR: 596.49,
    retailPriceZAR: 745.61,
    cpu: 'Quad-Core ARM Cortex-A53 @ 1.0GHz',
    ram: '512MB LPDDR2',
    qps: 500,
    maxClients: 50,
    cooling: '7mm Passive Aluminium Heatsink',
    display: 'Headless (Hotspot Failover + App)',
    badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  },
  {
    id: 'tier2_wired',
    name: 'Device 2: High-Reliability Wired Node',
    subtitle: 'Zero-Latency SME & Gaming Defense',
    targetMarket: 'Remote Workers, Small Businesses, VoIP & Gaming',
    baseCostZAR: 792.44,
    retailPriceZAR: 990.55,
    cpu: 'Quad-Core ARM Cortex-A53 @ 1.0GHz',
    ram: '512MB LPDDR2',
    qps: 500,
    maxClients: 100,
    cooling: '7mm Passive Aluminium Heatsink',
    display: 'Headless + Physical RJ45 Ethernet HAT (<2ms)',
    badgeColor: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
  },
  {
    id: 'tier3_visual',
    name: 'Device 3: Visual Interactive Node',
    subtitle: 'Prosumer Touch Kiosk with PADD Stats',
    targetMarket: 'Digital Guardians, Families, Home Offices',
    baseCostZAR: 1004.67,
    retailPriceZAR: 1255.84,
    cpu: 'Quad-Core ARM Cortex-A53 / ARM64',
    ram: '512MB - 1GB',
    qps: 500,
    maxClients: 100,
    cooling: '7mm Passive Heatsink assembly',
    display: '3.5" IPS Capacitive Touch Display (PADD)',
    badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  },
  {
    id: 'tier4_ai',
    name: 'Device 4: AI "Sentinel" Enterprise Node',
    subtitle: 'Neural Anomaly Detection & High-Density NOC',
    targetMarket: 'Hotels, Malls, Corporate HQs, Public Venues',
    baseCostZAR: 6753.06,
    retailPriceZAR: 8297.37,
    cpu: 'Quad-Core Cortex-A76 @ 2.4GHz + AI HAT+ (26 TOPS NPU)',
    ram: '16GB LPDDR4X (32x Capacity)',
    qps: 5000,
    maxClients: 1000,
    cooling: 'Active Cooler (Aluminium Heatsink + PWM Fan)',
    display: 'Official 7" Touchscreen + UPS Battery HAT',
    badgeColor: 'bg-purple-500/20 text-purple-400 border-purple-500/40',
  },
];

