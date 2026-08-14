import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { SECURITY_MODULES } from '../services/serviceManager';
import { Activity, Shield, Network, Server, Zap, Lock, Cpu, Globe, Target } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAppStore } from '../store/useAppStore';
import { gateflameApi } from '../services/gateflameApi';
import { useConnection } from '../hooks/useConnection';
import { SimulatedBadge } from './DataSourceBanner';
import { config } from '../config/env';
import type { ModuleMetricsResponse } from '../types/api';

/** Chart x-axis label: seconds ago, derived from the node's own timestamps. */
const relativeLabel = (iso: string, now: number): string => {
  const delta = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  return `${delta}s`;
};

export const DynamicModuleTab: React.FC<{ moduleId: string }> = ({ moduleId }) => {
  const moduleConfig = SECURITY_MODULES.find((m) => m.id === moduleId);
  const { userAccount } = useAppStore();
  const { dataSource, nodeName } = useConnection();
  const isDark = userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [metrics, setMetrics] = useState<ModuleMetricsResponse | null>(null);

  // Metrics come from the node. When none is reachable, gateflameApi routes to
  // the simulator and the connection state flips to `demo`, which is what makes
  // the SimulatedBadge appear below. Previously this component ran seven
  // Math.random() feeds on a 2s timer and presented them as measurements.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const next = await gateflameApi.moduleMetrics(moduleId);
        if (!cancelled) setMetrics(next);
      } catch {
        if (!cancelled) setMetrics(null);
      }
    };

    void load();
    const interval = setInterval(() => void load(), config.pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [moduleId]);

  if (!moduleConfig) return null;

  const now = Date.now();
  const chartData = (metrics?.series ?? []).map((p) => ({
    time: relativeLabel(p.t, now),
    value1: p.value1,
    value2: p.value2,
  }));
  const tiles = metrics?.tiles ?? [];

  const tooltipStyle = isDark 
    ? { backgroundColor: '#1e3a8a', borderColor: '#3b82f6', borderRadius: '12px', fontSize: '10px', color: '#60a5fa', padding: '8px' }
    : { backgroundColor: '#ffffff', borderColor: '#e5e7eb', borderRadius: '12px', fontSize: '10px', color: '#0f172a', padding: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' };

  return (
    <motion.div
      key={moduleId}
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.2 }}
      className="space-y-4 h-full flex flex-col overflow-y-auto pb-24 no-scrollbar"
    >
      <div className="bg-white dark:bg-blue-900/20 border border-slate-200 dark:border-blue-500/50 rounded-3xl p-5 shadow-sm shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-slate-50 dark:bg-blue-900/50 border border-slate-100 dark:border-blue-500/30 flex items-center justify-center shrink-0">
             <Zap className="w-5 h-5 text-sky-500 dark:text-blue-400 animate-pulse" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-blue-300 leading-tight">{moduleConfig.title}</h2>
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              <div className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-100 dark:bg-blue-900/30 text-emerald-700 dark:text-blue-300 text-[9px] font-mono rounded border border-emerald-200 dark:border-blue-500/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-blue-400 animate-pulse"></span>
                SERVICE ACTIVE
              </div>
              <SimulatedBadge />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 shrink-0">
        {[Activity, Shield, Network, Server].map((Icon, i) => ({
          label: tiles[i]?.label ?? ['Packets / Actions', 'Threats / Flags', 'Connections', 'Uptime'][i],
          // An em dash, not a plausible number. Until the node reports a value
          // there is nothing honest to display here.
          value: tiles[i]?.value ?? '—',
          unit: tiles[i]?.unit,
          icon: Icon,
        })).map((stat, i) => (
          <div key={i} className="bg-white dark:bg-blue-900/20 border border-slate-200 dark:border-blue-500/50 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
             <stat.icon className="w-4 h-4 mb-3 text-sky-500 dark:text-blue-400" />
             <div>
                 <div className="text-xl font-mono font-medium text-slate-900 dark:text-blue-100 tracking-tight">
                   {stat.value}{stat.unit ? <span className="text-xs ml-0.5 opacity-60">{stat.unit}</span> : null}
                 </div>
                 <div className="text-[9px] font-mono text-slate-400 dark:text-blue-400/60 uppercase tracking-wider mt-1">{stat.label}</div>
             </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-blue-900/20 border border-slate-200 dark:border-blue-500/50 rounded-3xl p-5 shrink-0 flex flex-col shadow-sm h-[200px]">
        <div className="flex justify-between items-start mb-4">
            <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-blue-300">Telemetry Flow</h3>
                <p className="text-[10px] font-mono text-slate-400 dark:text-blue-400/70 mt-0.5 uppercase tracking-widest">
                  {chartData.length === 0 ? 'Awaiting node' : 'From node'}
                </p>
            </div>
            <SimulatedBadge />
        </div>
        <div className="flex-1 min-h-0 -ml-4">
           <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVal1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isDark ? "#60a5fa" : "#0ea5e9"} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={isDark ? "#60a5fa" : "#0ea5e9"} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorVal2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={isDark ? "#3b82f6" : "#6366f1"} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={isDark ? "#3b82f6" : "#6366f1"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" stroke={isDark ? "#1e3a8a" : "#94a3b8"} fontSize={9} tickLine={false} axisLine={false} />
                <YAxis stroke={isDark ? "#1e3a8a" : "#94a3b8"} fontSize={9} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={{ padding: 0 }} />
                <Area type="monotone" dataKey="value1" stroke={isDark ? "#60a5fa" : "#0ea5e9"} strokeWidth={2} fill="url(#colorVal1)" isAnimationActive={false} />
                <Area type="monotone" dataKey="value2" stroke={isDark ? "#3b82f6" : "#6366f1"} strokeWidth={2} fill="url(#colorVal2)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
        </div>
      </div>
      
      {/* Console output visualizer */}
      <div className="bg-slate-900 dark:bg-blue-950/40 border border-slate-800 dark:border-blue-900/60 rounded-2xl p-4 font-mono text-[10px] text-emerald-400 dark:text-blue-500 h-32 overflow-hidden relative shrink-0">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent to-slate-900 dark:to-blue-950/20 z-10 pointer-events-none"></div>
        {/* Was a fixed set of invented lines printed regardless of state.
            Now it reports what the client actually knows. Per-module journald
            tailing needs GET /api/v1/services/{slug}/logs on the node — see
            docs/PAIRING-AND-TELEMETRY.md. */}
        <div className="space-y-1 relative z-0 flex flex-col justify-end h-full">
            <p>&gt; [API] endpoint {moduleConfig.apiEndpoint}</p>
            <p>&gt; [SRC] {dataSource === 'live' ? `live — ${nodeName ?? 'node'}` : dataSource === 'demo' ? 'SIMULATED — no node connected' : dataSource}</p>
            <p>&gt; [DATA] {chartData.length} point{chartData.length === 1 ? '' : 's'} in window</p>
            <p>&gt; [LOGS] awaiting /services/{moduleConfig.apiEndpoint.split('/').pop()}/logs</p>
        </div>
      </div>
    </motion.div>
  );
};
