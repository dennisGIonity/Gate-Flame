/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Onboard Device Container Architecture View
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React, { useState } from 'react';
import { 
  Box, Terminal, Cpu, HardDrive, CpuIcon, Layers, Server, ShieldCheck, 
  RefreshCw, CheckCircle2, Play, Lock, ExternalLink, Activity, Radio 
} from 'lucide-react';
import { ContainerSpec } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const CONTAINER_SPECS: ContainerSpec[] = [
  {
    id: 'pihole_ftl',
    name: 'gateflame-pihole-ftl',
    role: 'Primary DNS Ad & Threat Blocking Engine',
    baseImage: 'docker.io/pihole/pihole:latest-arm64',
    ramUsageMB: 48,
    cpuUsagePercent: 3.2,
    ports: ['53:53/udp', '53:53/tcp', '8080:80/tcp'],
    volumeMounts: ['/etc/pihole -> /etc/pihole', '/etc/dnsmasq.d -> /etc/dnsmasq.d'],
    status: 'running',
    description: 'Runs Pi-hole FTL engine filtering up to 10,000 queries/sec using gravity blocklists and custom Regex filters.'
  },
  {
    id: 'unbound_resolver',
    name: 'gateflame-unbound-dnssec',
    role: 'Zero-Telemetry Recursive Root Resolver',
    baseImage: 'docker.io/mvance/unbound:latest-arm64',
    ramUsageMB: 32,
    cpuUsagePercent: 1.1,
    ports: ['127.0.0.1:5335:5335/udp'],
    volumeMounts: ['/etc/unbound -> /etc/unbound'],
    status: 'running',
    description: 'Recursively queries ICANN root DNS servers directly using cryptographic DNSSEC validation, bypassing ISP trackers.'
  },
  {
    id: 'chromium_kiosk',
    name: 'gateflame-display-kiosk',
    role: 'Physical GPIO Touch Screen Kiosk Engine',
    baseImage: 'docker.io/gateflame/kiosk-openbox:latest',
    ramUsageMB: 110,
    cpuUsagePercent: 8.5,
    ports: ['DISPLAY=:0'],
    volumeMounts: ['/tmp/.X11-unix -> /tmp/.X11-unix', '/dev/dri -> /dev/dri'],
    status: 'running',
    description: 'Runs lightweight X11/Wayland with Chromium in --kiosk mode to display live telemetry and interactive touch UI on the 3.5" IPS screen.'
  },
  {
    id: 'mosquitto_mqtt',
    name: 'gateflame-scada-mosquitto',
    role: 'SCADA & Smart Room MQTT Telemetry Broker',
    baseImage: 'docker.io/library/eclipse-mosquitto:latest',
    ramUsageMB: 12,
    cpuUsagePercent: 0.4,
    ports: ['1883:1883/tcp', '9001:9001/tcp'],
    volumeMounts: ['/mosquitto/config -> /mosquitto/config'],
    status: 'running',
    description: 'Handles lightweight MQTT pub/sub for room ESP32 microcontrollers, water leak alerts, and hardware temperature sensors.'
  },
  {
    id: 'network_autopilot',
    name: 'gateflame-autopilot-daemon',
    role: 'Eth0 / Wlan0 Auto-Failover & MAC Bypasser',
    baseImage: 'docker.io/gateflame/autopilot-agent:v2.4',
    ramUsageMB: 18,
    cpuUsagePercent: 0.8,
    ports: ['host networking mode'],
    volumeMounts: ['/var/run/dbus -> /var/run/dbus'],
    status: 'running',
    description: 'Monitors Ethernet cable insertion, Wi-Fi reconnection, captive portal detection, and automated failover routing.'
  }
];

export const ContainerArchitectureView: React.FC = () => {
  const [selectedContainer, setSelectedContainer] = useState<ContainerSpec>(CONTAINER_SPECS[0]);
  const [activeTab, setActiveTab] = useState<'stack' | 'compose_yml' | 'architecture_diagram'>('stack');

  const totalRamUsed = CONTAINER_SPECS.reduce((acc, c) => acc + c.ramUsageMB, 0);

  const composeYmlString = `version: '3.8'

services:
  gateflame-pihole:
    container_name: gateflame-pihole-ftl
    image: pihole/pihole:latest
    restart: unless-stopped
    network_mode: host
    environment:
      TZ: 'Africa/Johannesburg'
      WEBPASSWORD: 'IonitySecurePassword2026'
      PIHOLE_DNS_: '127.0.0.1#5335'
      DNSMASQ_LISTENING: 'all'
    volumes:
      - '/etc/pihole:/etc/pihole'
      - '/etc/dnsmasq.d:/etc/dnsmasq.d'
    capabilities:
      - NET_ADMIN

  gateflame-unbound:
    container_name: gateflame-unbound-dnssec
    image: mvance/unbound:latest
    restart: unless-stopped
    ports:
      - '127.0.0.1:5335:5335/udp'
    volumes:
      - '/etc/unbound:/opt/unbound/etc/unbound'

  gateflame-kiosk:
    container_name: gateflame-display-kiosk
    image: gateflame/kiosk-openbox:latest
    restart: unless-stopped
    environment:
      - DISPLAY=:0
      - KIOSK_URL=http://localhost:8080/device-kiosk
    volumes:
      - '/tmp/.X11-unix:/tmp/.X11-unix'
      - '/dev/dri:/dev/dri'
    devices:
      - '/dev/fb0:/dev/fb0'

  gateflame-mosquitto:
    container_name: gateflame-scada-mosquitto
    image: eclipse-mosquitto:latest
    restart: unless-stopped
    ports:
      - '1883:1883'
      - '9001:9001'

  gateflame-autopilot:
    container_name: gateflame-autopilot-daemon
    image: gateflame/autopilot-agent:v2.4
    network_mode: host
    restart: unless-stopped
    volumes:
      - '/var/run/dbus:/var/run/dbus'
      - '/etc/network/interfaces:/etc/network/interfaces'`;

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Header Area */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
        <div>
          <h1 className="text-4xl font-display font-light text-white tracking-tight mb-2">
            Container <span className="font-bold">Architecture</span>
          </h1>
          <p className="text-sm font-mono text-slate-400">
            Isolated microservices running on Armbian / RPi OS Lite 64-bit Docker Engine
          </p>
        </div>
        <div className="glass-panel px-4 py-2 rounded-2xl flex items-center gap-3">
          <span className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400 uppercase">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> 5 / 5 Containers Running
          </span>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: Cpu, label: 'Runtime Engine', value: 'Docker Engine 26.1', sub: 'OCI Spec v1.1 Arm64' },
          { icon: CpuIcon, label: 'Stack RAM Usage', value: `${totalRamUsed} MB / 512 MB`, sub: 'Fits Orange Pi 512MB RAM' },
          { icon: Activity, label: 'Isolation Mode', value: 'Container Namespaces', sub: 'cgroups v2 + AppArmor' },
          { icon: Radio, label: 'Local DNS Port', value: '53 UDP/TCP & 5335', sub: 'Unbound Loopback Bound' }
        ].map((stat, i) => (
          <div key={i} className="glass-panel p-5 rounded-3xl space-y-2 hover:bg-white/[0.02] transition-colors">
            <div className="text-sky-400 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider font-bold mb-3">
              <stat.icon className="w-4 h-4" /> {stat.label}
            </div>
            <div className="text-base font-bold text-white font-display tracking-tight">{stat.value}</div>
            <div className="text-[11px] font-mono text-slate-500">{stat.sub}</div>
          </div>
        ))}
      </div>

      {/* Navigation Tabs */}
      <div className="flex gap-2 border-b border-white/5 pb-2 overflow-x-auto no-scrollbar">
        {([
          { id: 'stack', label: 'Stack Visualizer' },
          { id: 'compose_yml', label: 'docker-compose.yml' }
        ] as const).map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 rounded-xl transition-all whitespace-nowrap text-sm font-mono font-medium",
              activeTab === tab.id
                ? "bg-white text-black font-bold shadow-sm"
                : "bg-white/5 text-slate-400 hover:text-white hover:bg-white/10"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'stack' && (
          <motion.div 
            key="stack"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[500px]"
          >
            {/* Left: Container List */}
            <div className="space-y-4 lg:col-span-1 glass-panel p-6 rounded-3xl overflow-y-auto no-scrollbar">
              <h3 className="text-sm font-bold text-white flex items-center gap-2 font-mono uppercase tracking-wider mb-6">
                <Layers className="w-4 h-4 text-sky-400" /> Active Microservices
              </h3>

              <div className="space-y-3">
                {CONTAINER_SPECS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedContainer(c)}
                    className={cn(
                      "w-full text-left p-4 rounded-2xl border transition-all space-y-2 group",
                      selectedContainer.id === c.id
                        ? "bg-sky-500/10 border-sky-500/50"
                        : "bg-white/5 border-white/10 hover:border-white/20"
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-bold font-display text-sm tracking-tight text-white">{c.name}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                    </div>
                    <p className="text-[10px] text-slate-400 font-mono font-medium line-clamp-1">{c.role}</p>
                    <div className="flex justify-between items-center text-[10px] text-slate-500 pt-2 border-t border-white/5 font-mono font-medium">
                      <span>RAM: {c.ramUsageMB} MB</span>
                      <span>CPU: {c.cpuUsagePercent}%</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Right: Selected Container Detail Card */}
            <div className="lg:col-span-2 glass-panel p-6 sm:p-8 rounded-3xl flex flex-col relative overflow-hidden">
              <div className="absolute top-0 right-0 p-8 opacity-5">
                <Box className="w-48 h-48" />
              </div>
              
              <div className="relative z-10">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-white/5 pb-4 mb-6 gap-4">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-sky-400 bg-sky-500/10 px-2 py-1 rounded border border-sky-500/20 font-mono tracking-wider">
                      Container Inspector
                    </span>
                    <h3 className="text-2xl font-display font-medium text-white mt-3 mb-1">{selectedContainer.name}</h3>
                    <p className="text-xs text-slate-400 font-mono">{selectedContainer.role}</p>
                  </div>

                  <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1.5 rounded-xl text-[10px] font-bold font-mono uppercase tracking-wider flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    {selectedContainer.status}
                  </span>
                </div>

                <p className="text-sm text-slate-300 font-mono leading-relaxed mb-8 max-w-xl">
                  {selectedContainer.description}
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-2">
                    <span className="text-slate-500 text-[10px] font-mono font-bold uppercase tracking-wider">Base Image</span>
                    <p className="text-xs text-sky-400 font-mono truncate">{selectedContainer.baseImage}</p>
                  </div>

                  <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-2">
                    <span className="text-slate-500 text-[10px] font-mono font-bold uppercase tracking-wider">Memory Target</span>
                    <p className="text-xs text-white font-mono font-bold">{selectedContainer.ramUsageMB} MB RAM Allocated</p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <span className="text-slate-500 text-[10px] block font-mono font-bold uppercase tracking-wider">Exposed Ports & Network Bindings</span>
                    <div className="flex flex-wrap gap-2">
                      {selectedContainer.ports.map((p, idx) => (
                        <span key={idx} className="bg-white/5 text-slate-300 border border-white/10 px-3 py-1.5 rounded-xl text-[11px] font-mono">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <span className="text-slate-500 text-[10px] block font-mono font-bold uppercase tracking-wider">Mounted Persistent Storage Volumes</span>
                    <div className="space-y-2">
                      {selectedContainer.volumeMounts.map((v, idx) => (
                        <div key={idx} className="bg-white/5 text-slate-300 border border-white/10 px-4 py-2 rounded-xl text-[11px] font-mono flex items-center gap-3 w-fit">
                          <HardDrive className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'compose_yml' && (
          <motion.div
            key="compose"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }} 
            className="glass-panel p-6 rounded-3xl font-mono text-xs overflow-x-auto text-sky-400/90 leading-relaxed max-h-[500px]"
          >
            <div className="flex justify-between items-center border-b border-white/5 pb-4 mb-4 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <span>/opt/gateflame/docker-compose.yml</span>
              <span className="text-slate-600">YAML Manifest</span>
            </div>
            <pre><code>{composeYmlString}</code></pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
