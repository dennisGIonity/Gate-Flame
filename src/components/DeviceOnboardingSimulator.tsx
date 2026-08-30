/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Physical Device Kiosk & Onboarding Flow Simulator
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React, { useState, useEffect } from 'react';
import { OnboardingStep, NetworkOption, HardwareTierId, SystemTelemetry, IonityUserAccount } from '../types';
import { HARDWARE_TIERS, MOCK_NETWORKS, MOCK_THREAT_LOGS } from '../data/mockData';
import { 
  Power, ShieldCheck, Wifi, Cable, Key, CheckCircle2, 
  ArrowRight, RefreshCw, BarChart3, ChevronLeft, ChevronRight, SlidersHorizontal, Lock, Cpu, Sparkles, Activity, Palette
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { DNSTrafficChart } from './DNSTrafficChart';
import { cn, getFilterBorderColor } from '../lib/utils';
import { count } from '../lib/format';
import { LiveBackground } from './LiveBackground';

interface DeviceOnboardingSimulatorProps {
  telemetry: SystemTelemetry;
  userAccount: IonityUserAccount;
  onOnboardingComplete: () => void;
  onChangeFilterLevel: (level: 'none' | 'low' | 'medium' | 'high') => void;
  onUpdateUserAccount: (updated: Partial<IonityUserAccount>) => void;
}

import { useAppStore } from '../store/useAppStore';
export const DeviceOnboardingSimulator: React.FC = () => {
  const { telemetry, userAccount, resumeProtection: onOnboardingComplete, changeFilterLevel: onChangeFilterLevel, updateUserAccount: onUpdateUserAccount } = useAppStore();
  const [selectedTier, setSelectedTier] = useState<HardwareTierId>('tier3_visual');
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('power_on');
  const [bootProgress, setBootProgress] = useState(0);

  // Network selection state
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkOption | null>(MOCK_NETWORKS[0]);
  const [networkPassword, setNetworkPassword] = useState('SecurePass2026!');
  
  // User login state
  const [userEmail, setUserEmail] = useState('dennis.ionity.world@gmail.com');
  const [userPassword, setUserPassword] = useState('••••••••••••');

  // Initialization loading status
  const [initStage, setInitStage] = useState(0);
  const initMessages = [
    'Detecting active network interface (Ethernet/Wi-Fi)...',
    'Binding setupVars.conf & Unattended Pi-hole engine...',
    'Loading Unbound Recursive DNS Root Hints (named.root)...',
    'Ingesting 6,755,558 Gravity domains from global repositories...',
    'Activating mTLS zero-trust tunnel to Ionity Central Server...',
    'Gate^Flame Security Node Activated Successfully!'
  ];

  // Touch Screen Swipe/Tab Index (0: Queries, 1: Sinkhole, 2: Latency & Savings, 3: Clients, 4: Threat Pop Mini-Game, 5: Settings)
  const [touchTab, setTouchTab] = useState<number>(0);

  // Time series mock data
  const timeSeriesData = [
    { time: '00:00', total: 1200, blocked: 450 },
    { time: '04:00', total: 850, blocked: 310 },
    { time: '08:00', total: 4200, blocked: 1680 },
    { time: '12:00', total: 6800, blocked: 2510 },
    { time: '16:00', total: 8900, blocked: 3400 },
    { time: '20:00', total: 7100, blocked: 2800 },
    { time: '23:59', total: 9800, blocked: 3247 },
  ];

  const categoryBreakdown = [
    { name: 'Ad Trackers', value: 42, color: '#06B6D4' },
    { name: 'Telemetry', value: 28, color: '#10B981' },
    { name: 'Phishing', value: 15, color: '#F59E0B' },
    { name: 'Malware', value: 10, color: '#EC4899' },
    { name: 'Cryptojack', value: 5, color: '#8B5CF6' },
  ];

  // Boot progress timer
  useEffect(() => {
    if (currentStep === 'power_on') {
      setBootProgress(0);
      const interval = setInterval(() => {
        setBootProgress((prev) => {
          if (prev >= 100) {
            clearInterval(interval);
            setCurrentStep('welcome_greeting');
            return 100;
          }
          return prev + 20;
        });
      }, 300);
      return () => clearInterval(interval);
    }
  }, [currentStep]);

  // Initialization progress timer
  useEffect(() => {
    if (currentStep === 'initializing') {
      setInitStage(0);
      const interval = setInterval(() => {
        setInitStage((prev) => {
          if (prev >= initMessages.length - 1) {
            clearInterval(interval);
            setTimeout(() => {
              setCurrentStep('infographic_kiosk');
              onOnboardingComplete();
            }, 800);
            return initMessages.length - 1;
          }
          return prev + 1;
        });
      }, 700);
      return () => clearInterval(interval);
    }
  }, [currentStep]);

  const activeTierObj = HARDWARE_TIERS.find((t) => t.id === selectedTier) || HARDWARE_TIERS[2];

  const handleNetworkSubmit = () => {
    if (!selectedNetwork) return;
    if (selectedNetwork.type === 'ethernet') {
      setCurrentStep('user_auth');
    } else {
      setCurrentStep('network_auth');
    }
  };

  const handleNetworkAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentStep('user_auth');
  };

  const handleUserAuthSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentStep('initializing');
  };

  const nextTouchTab = () => setTouchTab((prev) => (prev + 1) % 5);
  const prevTouchTab = () => setTouchTab((prev) => (prev - 1 + 5) % 5);

  return (
    <div className="flex flex-col h-full space-y-6">
      {/* Top Header Controls: Tier Selection, Theme Shift & Reset */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-2">
        <div>
          <h1 className="text-4xl font-display font-light text-slate-900 dark:text-white tracking-tight mb-2">
            Device <span className="font-bold">Onboarding</span>
          </h1>
          <p className="text-sm font-mono text-slate-400">
            Simulates the physical edge node kiosk setup flow
          </p>
        </div>

        {/* Controls */}
        <div className={cn("glass-panel px-4 py-2 rounded-2xl flex items-center gap-3")}>
          {/* Hardware Tier Selector */}
          <select
            value={selectedTier}
            onChange={(e) => {
              setSelectedTier(e.target.value as HardwareTierId);
              setCurrentStep('power_on');
            }}
            className="bg-transparent border-none text-sky-400 font-mono text-xs font-bold uppercase tracking-wider focus:outline-none cursor-pointer"
          >
            {HARDWARE_TIERS.map((tier) => (
              <option key={tier.id} value={tier.id} className="bg-slate-950 text-white">
                {tier.name}
              </option>
            ))}
          </select>

          <div className="w-px h-4 bg-white/10" />

          <button
            onClick={() => setCurrentStep('power_on')}
            className="text-slate-400 hover:text-white transition-colors"
            title="Reboot Node"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Onboarding Sequence Step Navigator */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {[
          { id: 'power_on', label: '01 Boot POST' },
          { id: 'welcome_greeting', label: '02 Welcome' },
          { id: 'network_select', label: '03 Uplink Select' },
          { id: 'network_auth', label: '04 Wi-Fi Auth' },
          { id: 'user_auth', label: '05 Account Link' },
          { id: 'initializing', label: '06 Setup Engine' },
          { id: 'infographic_kiosk', label: '07 Kiosk Infographics' },
        ].map((stepItem) => (
          <button
            key={stepItem.id}
            onClick={() => setCurrentStep(stepItem.id as OnboardingStep)}
            className={cn(
              "px-4 py-2 rounded-xl whitespace-nowrap transition-colors font-mono text-xs font-medium",
              currentStep === stepItem.id
                ? "bg-white text-black font-bold shadow-sm"
                : "bg-white/5 text-slate-400 border border-white/5 hover:text-white hover:bg-white/10"
            )}
          >
            {stepItem.label}
          </button>
        ))}
      </div>

      {/* Hardware Frame Simulator Shell */}
      <div className="relative flex-1 min-h-[600px]">
        <div className={cn("glass-panel p-6 sm:p-8 rounded-3xl relative overflow-hidden h-full flex flex-col justify-between")}>
          <div className="absolute inset-0 z-0 pointer-events-none opacity-50">
            <LiveBackground level={telemetry.filterLevel} theme={userAccount.appTheme} />
          </div>
          
          {/* Top Touchscreen Bezel Header */}
          <div className="flex justify-between items-center text-xs font-mono text-slate-500 pb-4 border-b border-black/5 dark:border-white/5 relative z-10">
            <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-sky-400">
              <ShieldCheck className="w-4 h-4" />
              <span>Gate^Flame Touch Kiosk</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-white/10 text-white">
                {activeTierObj.name.split(':')[0]}
              </span>
            </div>
            <div className="text-[10px] hidden sm:block">
              Ionity Global (Pty) Ltd &bull; Registered Mark POL 986 AED
            </div>
          </div>

          {/* STEP 1: PLUG IN & TURN ON */}
          {currentStep === 'power_on' && (
            <div className="my-auto text-center space-y-6 py-8">
              <div className="inline-flex p-4 rounded-xl bg-sky-900/20 border border-sky-500/30 text-sky-500 animate-pulse">
                <Power className="w-10 h-10" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
                  PLUGGED IN & POWERED ON
                </h3>
                <p className="text-sm text-slate-400 font-mono mt-2">
                  System POST Diagnostics & Booting Kernel...
                </p>
              </div>

              {/* Boot Progress Bar */}
              <div className="max-w-md mx-auto space-y-2 font-sans">
                <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="bg-sky-500 h-full transition-all duration-300"
                    style={{ width: `${bootProgress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[11px] text-slate-500 font-medium">
                  <span>ARM64 CPU Init</span>
                  <span>{bootProgress}%</span>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: GREETING */}
          {currentStep === 'welcome_greeting' && (
            <div className="my-auto text-center space-y-6 py-6 font-sans">
              <div className="w-14 h-14 mx-auto rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center text-white shadow-sm border border-sky-400/30">
                <ShieldCheck className="w-8 h-8 text-white" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white font-sans tracking-tight">
                  Gate<span className="text-sky-500">^</span>Flame Welcome
                </h3>
                <p className="text-sm text-slate-400 max-w-md mx-auto mt-2 leading-relaxed">
                  Enterprise-Grade DNS Security & Privacy Node by Ionity Global (Pty) Ltd. Zero-touch installation ready.
                </p>
              </div>

              <div className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 max-w-sm mx-auto text-left text-xs space-y-2 text-slate-300">
                <p><strong className="text-sky-500 font-medium">Hardware Profile:</strong> {activeTierObj.name}</p>
                <p><strong className="text-sky-500 font-medium">Processor:</strong> {activeTierObj.cpu}</p>
                <p><strong className="text-sky-500 font-medium">Max Capacity:</strong> ~{activeTierObj.qps} QPS / {activeTierObj.maxClients} Clients</p>
              </div>

              <button
                onClick={() => setCurrentStep('network_selection')}
                className="bg-sky-600 hover:bg-sky-500 text-white font-bold px-6 py-3 rounded-lg text-sm transition-colors shadow-sm flex items-center justify-center gap-2 mx-auto uppercase tracking-wider"
              >
                Start Network Onboarding Setup <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* STEP 3: NETWORK SELECTION */}
          {currentStep === 'network_selection' && (
            <div className="my-auto space-y-4 py-4 font-sans">
              <div className="text-center">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-sans flex items-center justify-center gap-2">
                  <Wifi className="w-5 h-5 text-sky-500" /> Select Network Uplink Source
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Detecting Ethernet RJ45 Cable & Available Wi-Fi Networks
                </p>
              </div>

              <div className="space-y-2.5 max-w-lg mx-auto font-sans">
                {MOCK_NETWORKS.map((net) => {
                  const isSelected = selectedNetwork?.id === net.id;
                  return (
                    <div
                      key={net.id}
                      onClick={() => setSelectedNetwork(net)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-sky-900/20 border-sky-500 text-white shadow-sm'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${net.type === 'ethernet' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-sky-500/10 text-sky-500'}`}>
                          {net.type === 'ethernet' ? <Cable className="w-5 h-5" /> : <Wifi className="w-5 h-5" />}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-slate-200 flex items-center gap-2">
                            {net.ssid}
                            {net.type === 'ethernet' && (
                              <span className="text-[9px] bg-emerald-500/10 text-emerald-500 px-1.5 py-0.5 rounded border border-emerald-500/20">
                                PRIORITY WIRED
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {net.type === 'ethernet' ? 'LAN Interface (1000Mbps)' : `${net.frequency} • Signal: ${net.signalStrength}%`}
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        {isSelected ? (
                          <CheckCircle2 className="w-5 h-5 text-sky-500" />
                        ) : (
                          <span className="text-[10px] text-slate-500">Tap to Select</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="text-center pt-2">
                <button
                  onClick={handleNetworkSubmit}
                  disabled={!selectedNetwork}
                  className="bg-sky-600 hover:bg-sky-500 text-white font-bold px-6 py-2.5 rounded-lg text-xs transition-all shadow-sm inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue with Selected Network <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: NETWORK AUTH */}
          {currentStep === 'network_auth' && (
            <div className="my-auto space-y-4 py-4 max-w-md mx-auto font-sans">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-slate-900 border border-slate-800 text-sky-500 flex items-center justify-center mb-2">
                  <Key className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-sans">
                  Network Authentication
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Connecting to <strong className="text-sky-500 font-medium">{selectedNetwork?.ssid}</strong>
                </p>
              </div>

              <form onSubmit={handleNetworkAuthSubmit} className="space-y-3 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">Enter Wi-Fi Password:</label>
                  <input
                    type="password"
                    value={networkPassword}
                    onChange={(e) => setNetworkPassword(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCurrentStep('network_selection')}
                    className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 py-2.5 rounded-lg text-xs font-medium transition-colors"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-sky-600 hover:bg-sky-500 text-white font-bold py-2.5 rounded-lg text-xs transition-colors"
                  >
                    Authenticate Network
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STEP 5: USER & DEVICE AUTH */}
          {currentStep === 'user_auth' && (
            <div className="my-auto space-y-4 py-4 max-w-md mx-auto font-sans">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 text-white flex items-center justify-center mb-2 shadow-sm border border-sky-400/30">
                  <Lock className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white font-sans">
                  Gate<span className="text-sky-500">^</span>Flame User Authentication
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Sync physical node with Ionity account for warranty & Gravity updates
                </p>
              </div>

              <form onSubmit={handleUserAuthSubmit} className="space-y-3 bg-slate-900/50 p-4 rounded-xl border border-slate-800">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">Ionity Account Email:</label>
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    required
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1 font-medium">Account Password:</label>
                  <input
                    type="password"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    required
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-sky-400 focus:outline-none focus:border-sky-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold py-2.5 rounded-xl text-xs font-mono shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4" /> Link Node & Activate Full Protection
                </button>
              </form>
            </div>
          )}

          {/* STEP 6: PROTECTION INITIALIZING */}
          {currentStep === 'initializing' && (
            <div className="my-auto text-center space-y-6 py-8 font-sans">
              <div className="p-4 rounded-xl bg-sky-500/10 text-sky-500 inline-block">
                <RefreshCw className="w-10 h-10 animate-spin" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-200 font-sans tracking-tight">
                  Initializing Gate^Flame Shield Engine
                </h3>
                <p className="text-xs text-emerald-500 font-bold uppercase tracking-wider mt-1">
                  Zero-Touch Automated Bootstrapping in Progress
                </p>
              </div>

              <div className="max-w-md mx-auto bg-slate-900 p-4 rounded-xl border border-slate-800 text-left text-xs font-mono space-y-2 text-slate-300 shadow-inner">
                {initMessages.map((msg, idx) => (
                  <div key={idx} className={`flex items-center gap-2 ${idx <= initStage ? 'text-sky-400' : 'text-slate-600'}`}>
                    <span className={idx <= initStage ? 'text-emerald-500' : 'text-slate-700'}>
                      {idx <= initStage ? '✓' : '○'}
                    </span>
                    <span>{msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 7: INFOGRAPHIC TOUCH KIOSK (Swipeable Tabs & Mini Game) */}
          {currentStep === 'infographic_kiosk' && (
            <div className="space-y-4 font-mono my-auto">
              {/* Swipeable Tabs Header (Scrollbar hidden, side arrows navigation) */}
              <div className="flex items-center gap-2 bg-slate-900/50 p-2 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={prevTouchTab}
                  className="p-2 bg-slate-900 hover:bg-sky-600 hover:text-white text-sky-500 rounded-lg border border-slate-800 transition-colors shrink-0 active:scale-95"
                  title="Previous Tab"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <div className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth py-0.5 text-[11px] flex-1 font-sans font-medium">
                  {['01 Traffic Graph', '02 Sinkhole Matrix', '03 Data & Latency', '04 Client Nodes', '05 Node Config'].map((tabLabel, idx) => (
                    <button
                      key={tabLabel}
                      onClick={() => setTouchTab(idx)}
                      className={`px-3 py-1.5 rounded-lg border transition-all whitespace-nowrap shrink-0 ${
                        touchTab === idx
                          ? 'bg-sky-600 text-white font-bold border-sky-500 shadow-sm'
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {tabLabel}
                    </button>
                  ))}
                </div>

                <button
                  onClick={nextTouchTab}
                  className="p-2 bg-slate-900 hover:bg-slate-800 text-sky-500 rounded-lg border border-slate-800 transition-all shrink-0 active:scale-95"
                  title="Next Tab"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Touch Screen 1: Traffic Area & Bar Chart */}
              {touchTab === 0 && (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3 font-sans">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-xs uppercase font-bold text-sky-500 tracking-wider">
                        Infographic Screen 1 / 5: Traffic Time Series
                      </div>
                      <div className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight mt-0.5">
                        {count(telemetry.totalQueriesToday)} Queries
                      </div>
                    </div>
                    <span className="text-[10px] text-sky-400 bg-sky-500/10 px-2 py-1 rounded border border-sky-500/20 font-medium">
                      Peak: 9,800 QPS
                    </span>
                  </div>

                  <div className="h-40 w-full mt-2">
                    <DNSTrafficChart data={timeSeriesData} theme={userAccount.appTheme} />
                  </div>
                </div>
              )}

              {/* Touch Screen 2: Threat Matrix Pie & Categories */}
              {touchTab === 1 && (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3">
                  <div className="text-xs uppercase font-bold text-slate-400 text-center tracking-wider">
                    Infographic Screen 2 / 5: Sinkholed Threat Distribution
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                    <div className="h-36 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={categoryBreakdown}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={30}
                            outerRadius={50}
                            paddingAngle={5}
                          >
                            {categoryBreakdown.map((entry, index) => (
                              <Cell key={`cell-${index}`} fill={entry.color} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ 
    backgroundColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0F172A' : '#ffffff', 
    borderColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#334155' : '#e5e7eb', 
    borderRadius: '8px', 
    fontSize: '11px', 
    color: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#F8FAFC' : '#0f172a',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
  }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="space-y-1 text-xs">
                      {categoryBreakdown.map((c) => (
                        <div key={c.name} className="flex justify-between items-center bg-slate-900 px-2.5 py-1.5 rounded-lg border border-slate-800">
                          <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                            {c.name}
                          </span>
                          <strong className="text-white">{c.value}%</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Touch Screen 3: Latency & Data Savings */}
              {touchTab === 2 && (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3 font-sans">
                  <div className="text-xs uppercase font-bold text-slate-400 text-center tracking-wider">
                    Infographic Screen 3 / 5: Latency & Data Savings Comparison
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-center">
                    <div className="bg-slate-900 p-3 rounded-lg border border-slate-800">
                      <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">Wi-Fi Latency</div>
                      <div className="text-xl font-bold text-slate-200">12.4 ms</div>
                      <div className="text-[9px] text-slate-500 mt-1">Orange Pi 2.4G/5G Antenna</div>
                    </div>

                    <div className="bg-slate-900 p-3 rounded-lg border border-emerald-500/20">
                      <div className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-1">Ethernet Hat Latency</div>
                      <div className="text-xl font-bold text-emerald-400">0.8 ms</div>
                      <div className="text-[9px] text-emerald-500/70 mt-1">Direct Hardware RJ45 Bus</div>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs text-slate-400 leading-relaxed text-center">
                    <strong className="text-sky-400 font-semibold">Data Saved Today:</strong> 1,420.5 MB of unwanted trackers & autoplay videos prevented from reaching client devices.
                  </div>
                </div>
              )}

              {/* Touch Screen 4: Client Nodes Bar Chart */}
              {touchTab === 3 && (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-2">
                  <div className="text-xs uppercase font-bold text-slate-400 text-center tracking-wider">
                    Infographic Screen 4 / 5: Active Network Client Nodes
                  </div>
                  <div className="h-36 w-full mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={[
                        { name: 'Smart TV', count: 8900 },
                        { name: 'MacBook', count: 12450 },
                        { name: 'Workstation', count: 9100 },
                        { name: 'Phones', count: 4300 },
                        { name: 'Tablets', count: 2680 },
                      ]}>
                        <XAxis dataKey="name" stroke="#64748B" fontSize={10} tickLine={false} />
                        <YAxis stroke="#64748B" fontSize={10} tickLine={false} />
                        <Tooltip contentStyle={{ 
    backgroundColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#0F172A' : '#ffffff', 
    borderColor: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#334155' : '#e5e7eb', 
    borderRadius: '8px', 
    fontSize: '11px', 
    color: userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) ? '#F8FAFC' : '#0f172a',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
  }} />
                        <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Touch Screen 5: Settings & Node Status */}
              {touchTab === 4 && (
                <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3 text-xs font-sans">
                  <div className="text-xs font-bold text-slate-300 text-center flex items-center justify-center gap-1.5 uppercase tracking-wider">
                    <SlidersHorizontal className="w-4 h-4 text-sky-500" /> Infographic Screen 5 / 5: Node Settings
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-center">
                      <div className="text-slate-500 uppercase tracking-wider font-bold mb-1 text-[9px]">DNS Resolver:</div>
                      <div className="text-sky-400 font-bold">Unbound Recursive</div>
                    </div>
                    <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-center">
                      <div className="text-slate-500 uppercase tracking-wider font-bold mb-1 text-[9px]">Active Uplink:</div>
                      <div className="text-emerald-400 font-bold">{selectedNetwork?.ssid}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-center">
                      <div className="text-slate-500 uppercase tracking-wider font-bold mb-2 text-[9px]">Defense Level</div>
                      <select
                        value={telemetry.filterLevel}
                        onChange={(e) => onChangeFilterLevel(e.target.value as 'none' | 'low' | 'medium' | 'high')}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-sky-400 font-sans font-bold uppercase tracking-wider focus:outline-none focus:border-sky-500 appearance-none text-center cursor-pointer"
                      >
                        <option value="none">Off</option>
                        <option value="low">Eco</option>
                        <option value="medium">Active</option>
                        <option value="high">Ionity Full Protection</option>
                      </select>
                    </div>

                    <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-center">
                      <div className="text-slate-500 uppercase tracking-wider font-bold mb-2 text-[9px]">Theme</div>
                      <select
                        value={userAccount.appTheme}
                        onChange={(e) => onUpdateUserAccount({ appTheme: e.target.value as 'light' | 'dark' | 'system' })}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-sky-400 font-sans font-bold uppercase tracking-wider focus:outline-none focus:border-sky-500 appearance-none text-center cursor-pointer"
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="system">System</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-[10px] text-slate-400 space-y-1.5 text-center">
                    <p><strong className="text-slate-300">Ionity Global (Pty) Ltd Warranty:</strong> Active (R45/mo)</p>
                    <p><strong className="text-slate-300">Hotspot Failover:</strong> SSID PiHole_Config_Setup Ready</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bottom Kiosk Status Footer */}
          <div className="pt-4 border-t border-white/5 flex justify-between items-center text-[10px] font-mono text-slate-500 font-medium uppercase tracking-wider mt-6">
            <span>Uptime: 24h 00m 20s</span>
            <span>Ionity Gate^Flame Node</span>
            <span>IP: 192.168.1.105</span>
          </div>
        </div>
      </div>
    </div>
  );
};

