/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Future Feature Expansion Roadmap (LATER Phase Features)
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React, { useState } from 'react';
import { FutureFeatureModule } from '../types';
import { 
  Sparkles, ShieldCheck, Cpu, Layers, Lock, ToggleLeft, ToggleRight, 
  Hotel, Wifi, RefreshCw, AlertCircle, CheckCircle2, ChevronRight 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const INITIAL_FUTURE_MODULES: FutureFeatureModule[] = [
  {
    id: 'ai_anomaly_detection',
    name: 'AI Sentinel Behavioral Anomaly Detection',
    category: 'AI & Intelligence',
    status: 'planned_later',
    description: 'Uses NPU on Raspberry Pi AI HAT+ (26 TOPS) to detect novel zero-day phishing patterns and botnet C&C behaviors without waiting for static blocklists.',
    targetHardware: 'Device 4 (RPi 5 16GB + AI HAT+)',
    enabledLater: false,
    docReference: 'ION-GF-STR-2026-009 (Section 2, Tier 4)',
  },
  {
    id: 'suricata_ids_ips',
    name: 'Suricata Intrusion Detection & Fail2Ban IPS',
    category: 'Network Security',
    status: 'planned_later',
    description: 'Deep-packet inspection for port scans, brute-force SSH attacks, and anomalous bandwidth exfiltration. Dynamically rewrites UFW firewall rules.',
    targetHardware: 'Device 2, Device 3 & Device 4',
    enabledLater: false,
    docReference: 'ION-GF-UC-2026-010 (Part 1, IPS)',
  },
  {
    id: 'captive_portal_mac_cloning',
    name: 'Hotspot Captive Portal MAC Bypasser & Hotel Nomad',
    category: 'Travel & Failover',
    status: 'planned_later',
    description: 'Allows travelers to SSH into the Zero 2 W node and clone a smartphone authenticated MAC address to bypass captive portals in hotels or public Wi-Fi.',
    targetHardware: 'Device 1 (Minimalist Travel Node)',
    enabledLater: false,
    docReference: 'ION-GF-PNP-2026-003 (Device 1)',
  },
  {
    id: 'hospitality_scada_grid',
    name: 'Hospitality Smart Room SCADA & Occupancy Grid',
    category: 'Hospitality SCADA',
    status: 'planned_later',
    description: 'Integrates room ESP32 microcontrollers for HVAC pre-cooling, water leak detection, door open alerts, and non-audio noise monitoring.',
    targetHardware: 'Project Root System [RPS01]',
    enabledLater: false,
    docReference: 'ION-GF-PDS-RPS01-2026-011 (Section A-E)',
  },
  {
    id: 'ota_firmware_signing',
    name: 'RSA/ECC Signed OTA Firmware & Rollback Engine',
    category: 'Enterprise Hardware',
    status: 'planned_later',
    description: 'HTTPS/MQTT TLS transport with RSA-2048 cryptographic signature verification before applying firmware updates with A/B partition recovery.',
    targetHardware: 'All Gate^Flame Hardware Tiers',
    enabledLater: false,
    docReference: 'ION-GF-GAP-2026-013 (Section 11.7)',
  },
  {
    id: 'esp8266_telemetry_hardware',
    name: 'ESP8266 Physical OLED Remote Telemetry Monitor',
    category: 'Enterprise Hardware',
    status: 'planned_later',
    description: 'Dedicated Wemos D1 Mini + SSD1306 OLED screen hardware widget fetching live queries and block counts via Pi-hole API.',
    targetHardware: 'Standalone Desktop Accessory',
    enabledLater: false,
    docReference: 'ION-GF-FE-2026-001 (Section 6)',
  },
];

export const FutureFeatureRoadmap: React.FC = () => {
  const [modules, setModules] = useState<FutureFeatureModule[]>(INITIAL_FUTURE_MODULES);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const toggleModule = (id: string) => {
    setModules((prev) =>
      prev.map((mod) =>
        mod.id === id ? { ...mod, enabledLater: !mod.enabledLater } : mod
      )
    );
  };

  const categories = ['All', 'AI & Intelligence', 'Network Security', 'Hospitality SCADA', 'Travel & Failover', 'Enterprise Hardware'];

  const filteredModules = selectedCategory === 'All'
    ? modules
    : modules.filter((m) => m.category === selectedCategory);

  const activeLaterCount = modules.filter((m) => m.enabledLater).length;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
        <div>
          <h1 className="text-4xl font-display font-light text-white tracking-tight mb-2">
            Expansion <span className="font-bold">Roadmap</span>
          </h1>
          <p className="text-sm font-mono text-slate-400">
            Modular architecture designed for plug-and-play feature additions in future software updates
          </p>
        </div>
        <div className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400 uppercase">Scheduled</span>
          <span className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400 uppercase">
            {activeLaterCount} / {modules.length} Pre-Configured
          </span>
        </div>
      </div>

      {/* Info Banner */}
      <div className="glass-panel rounded-3xl p-6 bg-amber-500/5 border-amber-500/10 flex items-start gap-4">
        <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="text-sm font-mono leading-relaxed space-y-2">
          <p><strong className="text-sky-400 font-sans tracking-wide uppercase text-[11px] mr-2">Phase 1 (Baseline Release):</strong> Runs standard Pi-hole + DNS + Unbound + Autopilot setup as requested.</p>
          <p><strong className="text-amber-400 font-sans tracking-wide uppercase text-[11px] mr-2">Phase 2 (Future Additions):</strong> The code structure and API endpoints are built modularly so these advanced capabilities can be toggled on later without altering core baseline stability.</p>
        </div>
      </div>

      {/* Category Filters */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={cn(
              "px-4 py-2 rounded-xl whitespace-nowrap transition-colors font-mono text-xs font-medium",
              selectedCategory === cat
                ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 shadow-sm"
                : "bg-white/5 text-slate-400 border border-white/5 hover:text-white hover:bg-white/10"
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Module Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AnimatePresence mode="popLayout">
          {filteredModules.map((mod) => (
            <motion.div
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={mod.id}
              className={cn(
                "glass-panel p-6 rounded-3xl transition-all space-y-4 cursor-pointer relative overflow-hidden group",
                mod.enabledLater
                  ? "bg-amber-500/5 border-amber-500/30"
                  : "hover:border-white/20"
              )}
              onClick={() => toggleModule(mod.id)}
            >
              <div className="flex justify-between items-start">
                <span className="text-[10px] uppercase font-bold px-2.5 py-1 rounded-md bg-black/50 text-slate-300 border border-white/10 font-mono tracking-wider">
                  {mod.category}
                </span>

                <div className="text-amber-400 transition-colors flex items-center gap-1.5 text-xs">
                  {mod.enabledLater ? (
                    <>
                      <ToggleRight className="w-6 h-6 text-amber-400" />
                      <span className="text-[11px] font-bold font-mono tracking-wider text-amber-400 uppercase">Scheduled</span>
                    </>
                  ) : (
                    <>
                      <ToggleLeft className="w-6 h-6 text-slate-600 group-hover:text-amber-400/50 transition-colors" />
                    </>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-lg font-display font-medium text-white mb-2">
                  {mod.name}
                </h3>
                <p className="text-xs font-mono text-slate-400 leading-relaxed">
                  {mod.description}
                </p>
              </div>

              <div className="pt-4 border-t border-white/5 flex flex-col sm:flex-row justify-between sm:items-center text-[10px] text-slate-500 font-mono font-medium gap-2">
                <span>Target: <strong className="text-slate-300">{mod.targetHardware}</strong></span>
                <span>Ref: <strong className="text-sky-400">{mod.docReference.split(' ')[0]}</strong></span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
};
