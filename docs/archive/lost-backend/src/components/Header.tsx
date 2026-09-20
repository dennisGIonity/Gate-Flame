/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Ionity Global (Pty) Ltd — Header Component
 */

import React from 'react';
import { AppViewMode } from '../types';
import { ShieldCheck, Smartphone, Cpu, Server, Terminal, Lock, ExternalLink, Sparkles, Package, Box } from 'lucide-react';

interface HeaderProps {
  currentView: AppViewMode;
  onSelectView: (view: AppViewMode) => void;
  protectionActive: boolean;
  totalBlocked: number;
  filterLevel: 'none' | 'low' | 'medium' | 'high';
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onSelectView,
  protectionActive,
  totalBlocked,
  filterLevel,
}) => {
  const getFilterColorClass = () => {
    if (!protectionActive) return 'text-rose-400';
    switch (filterLevel) {
      case 'none': return 'text-slate-400';
      case 'low': return 'text-sky-400';
      case 'medium': return 'text-amber-400';
      case 'high': return 'text-emerald-400';
      default: return 'text-emerald-400';
    }
  };

  const getFilterBgClass = () => {
    if (!protectionActive) return 'bg-rose-400';
    switch (filterLevel) {
      case 'none': return 'bg-slate-400';
      case 'low': return 'bg-sky-400';
      case 'medium': return 'bg-amber-400';
      case 'high': return 'bg-emerald-400';
      default: return 'bg-emerald-400';
    }
  };

  return (
    <header className="bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 sticky top-0 z-50 shadow-lg font-sans">
      {/* Top Corporate Status Banner */}
      <div className="bg-slate-950 text-slate-400 text-[11px] font-mono py-1.5 px-4 border-b border-slate-800/60 flex justify-between items-center overflow-x-auto whitespace-nowrap">
        <div className="flex items-center gap-3">
          <span className="text-sky-400 font-bold tracking-wider uppercase flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-sky-400" /> IONITY GLOBAL (Pty) Ltd
          </span>
          <span className="text-slate-700">|</span>
          <span className="text-slate-400 tracking-wide">AED-POL-986-ENTERPRISE</span>
          <span className="text-slate-700">|</span>
          <span className={`${getFilterColorClass()} flex items-center gap-1`}>
            <span className={`w-1.5 h-1.5 rounded-full ${getFilterBgClass()} animate-pulse`} /> Gate^Flame™ Edge AI Active
          </span>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono">
          <a
            href="https://ionity.co.za/"
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 hover:text-sky-400 flex items-center gap-1 transition-colors"
          >
            ionity.co.za <ExternalLink className="w-2.5 h-2.5" />
          </a>
          <a
            href="https://www.ionity.today/"
            target="_blank"
            rel="noreferrer"
            className="text-sky-400 hover:text-sky-300 flex items-center gap-1 transition-colors"
          >
            ionity.today <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>

      {/* Main Corporate Header */}
      <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        {/* Logo & Product Mark */}
        <div className="flex items-center gap-3">
          <div className="relative cursor-pointer" onClick={() => onSelectView('mobile_apk')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-700 flex items-center justify-center text-white shadow-md border border-sky-400/30">
              <ShieldCheck className="w-5 h-5 text-white" />
            </div>
            {protectionActive && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${getFilterBgClass()} opacity-75`}></span>
                <span className={`relative inline-flex rounded-full h-3 w-3 ${getFilterBgClass()}`}></span>
              </span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-white font-sans flex items-center gap-1">
                Gate<span className="text-sky-400 font-extrabold">^</span>Flame
                <span className="text-[10px] font-mono text-slate-400 border border-slate-700 bg-slate-900 px-1 py-0.5 rounded ml-0.5 font-normal">
                  TM
                </span>
              </h1>
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-sky-950/80 text-sky-400 border border-sky-800/60 font-semibold tracking-wider">
                DNS Firewall 2026
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-sans">
              Ionity Hardware Security Perimeter &bull; Enterprise Edge Node Architecture
            </p>
          </div>
        </div>

        {/* Live Status Indicators */}
        <div className="hidden lg:flex items-center gap-4 bg-slate-900/80 px-3.5 py-1.5 rounded-xl border border-slate-800 text-xs font-mono">
          <div className="flex flex-col text-right">
            <span className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">Gravity Status</span>
            <span className={`${getFilterColorClass()} font-bold flex items-center justify-end gap-1.5`}>
              <span className={`w-1.5 h-1.5 rounded-full ${getFilterBgClass()}`} />
              {protectionActive ? `Sinkhole: ${filterLevel === 'high' ? 'Ionity - Full' : filterLevel.toUpperCase()}` : 'Paused'}
            </span>
          </div>
          <div className="h-6 w-px bg-slate-800" />
          <div className="flex flex-col">
            <span className="text-[9px] text-slate-500 uppercase font-semibold tracking-wider">24h Purged</span>
            <span className="text-emerald-400 font-bold">{totalBlocked.toLocaleString()}</span>
          </div>
        </div>

        {/* Executive Navigation Switcher */}
        <nav className="flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 overflow-x-auto no-scrollbar">
          {[
            { id: 'mobile_apk', label: 'Mobile APK', icon: Smartphone },
            { id: 'device_kiosk', label: 'Node Kiosk', icon: Cpu },
            { id: 'server_sync', label: 'Server Sync', icon: Server },
            { id: 'container_architecture', label: 'Containers', icon: Box },
            { id: 'scripts_bom', label: 'Scripts & BOM', icon: Terminal },
            { id: 'future_roadmap', label: 'Roadmap', icon: Sparkles },
            { id: 'package_export', label: 'Export App', icon: Package },
          ].map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectView(item.id as AppViewMode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-sky-600 text-white font-semibold shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
