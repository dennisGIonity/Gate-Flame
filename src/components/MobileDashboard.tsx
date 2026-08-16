import React, { Suspense, lazy, useState, useMemo, useRef, useCallback } from 'react';
import { SystemTelemetry, ThreatLogEntry, ConnectedClient, IonityUserAccount } from '../types';
import { LiveBackground } from './LiveBackground';
import {
  ShieldCheck, ShieldAlert, Activity, RefreshCw, Power, Plus,
  BarChart3, Wifi, Layers, CheckCircle2, Lock, Sparkles,
  SlidersHorizontal, Tv, Laptop, Smartphone, Server, Gamepad2, ChevronDown, ChevronUp, Terminal, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SECURITY_MODULES, ApiService } from '../services/serviceManager';
import { cn, getFilterBorderColor, getFilterColor } from '../lib/utils';
import { InlineFallback, PanelFallback } from './LazyFallback';

/*
 * Code-split boundaries.
 *
 * This dashboard is the app's first paint, so anything it does not need in
 * order to draw that first screen is loaded on demand:
 *
 *  - the two recharts surfaces, because recharts plus its d3 and redux
 *    dependency tree is ~415 kB — 45% of what the entry chunk used to be;
 *  - the particle canvas and the game, only reachable on the `shield` and
 *    `game` tabs;
 *  - per-module tabs and the settings pane, which most sessions never open.
 *
 * The dashboard tab's own chart is lazy as well. It is above the fold, but it
 * sits in a fixed-height panel with its own fallback, so deferring it costs a
 * brief spinner in one panel instead of ~415 kB before anything renders at all.
 */
const DNSTrafficChart = lazy(() =>
  import('./DNSTrafficChart').then((m) => ({ default: m.DNSTrafficChart })),
);
const ThreatCategoryChart = lazy(() =>
  import('./ThreatCategoryChart').then((m) => ({ default: m.ThreatCategoryChart })),
);
const GravityParticleCanvas = lazy(() =>
  import('./GravityParticleCanvas').then((m) => ({ default: m.GravityParticleCanvas })),
);
const IonicrobesGame = lazy(() =>
  import('./IonicrobesGame').then((m) => ({ default: m.IonicrobesGame })),
);
const DynamicModuleTab = lazy(() =>
  import('./DynamicModuleTab').then((m) => ({ default: m.DynamicModuleTab })),
);
const SettingsManager = lazy(() =>
  import('./SettingsManager').then((m) => ({ default: m.SettingsManager })),
);

interface MobileDashboardProps {
  telemetry: SystemTelemetry;
  threatLogs: ThreatLogEntry[];
  clients: ConnectedClient[];
  userAccount: IonityUserAccount;
  onPauseProtection: (durationMinutes: number) => void;
  onResumeProtection: () => void;
  onAddWhitelistDomain: (domain: string) => void;
  onRefreshGravity: () => void;
  onRebootDevice: () => void;
  onChangeFilterLevel: (level: 'none' | 'low' | 'medium' | 'high') => void;
  onUpdateUserAccount: (updated: Partial<IonityUserAccount>) => void;
}

import { useAppStore } from '../store/useAppStore';
import { DataSourceBanner } from './DataSourceBanner';

const GlassPanel: React.FC<{ children: React.ReactNode, className?: string, filterLevel: string }> = ({ children, className, filterLevel }) => {
  return (
    <div className={cn("relative z-0", className)}>
      <div className="absolute inset-0 bg-white/95 dark:bg-black/60 backdrop-blur-3xl rounded-[inherit] shadow-[0_8px_32px_rgba(0,0,0,0.05)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] pointer-events-none transition-colors duration-500 group-hover:bg-white dark:group-hover:bg-black/70" />
      <AnimatePresence>
        <motion.div
           key={filterLevel}
           initial={{ opacity: 0 }}
           animate={{ opacity: 1 }}
           exit={{ opacity: 0 }}
           transition={{ duration: 0.5, ease: 'easeInOut' }}
           className={cn("absolute inset-0 rounded-[inherit] pointer-events-none border", getFilterBorderColor(filterLevel))}
        />
      </AnimatePresence>
      <div className="relative z-10 h-full w-full flex flex-col rounded-[inherit]">
         {children}
      </div>
    </div>
  );
};

const TerminalView: React.FC = () => {
  const threatLogs = useAppStore(state => state.threatLogs);

  // This console previously invented a line every 4.5 seconds from a fixed
  // list — "Threat neutralized: ads.track.net", "Ping response: 12ms",
  // "Device onboarded successfully." — whether or not anything was connected,
  // and with no marker that it was fiction. Fabricated *security events* are
  // the least defensible thing this UI could display, so they are gone.
  //
  // It now mirrors the real threat log, which is itself either live from the
  // node or clearly marked simulated by DataSourceBanner. Per-module journald
  // tailing needs GET /api/v1/services/{slug}/logs on the node — see
  // docs/PAIRING-AND-TELEMETRY.md.
  const logs = useMemo(
    () =>
      threatLogs.slice(0, 100).map(entry => ({
        id: entry.id,
        time: entry.timestamp,
        text: `${entry.action}: ${entry.domain} (${entry.category}) — ${entry.clientName}`,
        type: (entry.action === 'Blocked'
          ? 'alert'
          : entry.action === 'Whitelisted'
            ? 'success'
            : 'info') as 'info' | 'alert' | 'success',
      })),
    [threatLogs],
  );

  const terminalRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="flex-1 bg-black/90 border border-slate-800 rounded-3xl overflow-hidden backdrop-blur-xl flex flex-col shadow-2xl h-[500px]">
      <div className="w-full shrink-0 flex items-center px-4 py-4 bg-slate-900/80 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-sky-400" />
          <span className="text-sm font-mono text-slate-300 uppercase tracking-widest">Live Terminal</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2 no-scrollbar" ref={terminalRef}>
        {logs.map(log => (
          <div key={log.id} className="flex gap-3 leading-relaxed">
            <span className="text-slate-600 shrink-0">[{log.time}]</span>
            <span className={cn(
              log.type === 'alert' && "text-rose-400",
              log.type === 'success' && "text-emerald-400",
              log.type === 'info' && "text-sky-300"
            )}>
              {log.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const MobileDashboard: React.FC = () => {
  const { telemetry, threatLogs, clients, userAccount, activeModules, toggleModule, pauseProtection: onPauseProtection, resumeProtection: onResumeProtection, addWhitelistDomain: onAddWhitelistDomain, refreshGravity: onRefreshGravity, rebootDevice: onRebootDevice, changeFilterLevel: onChangeFilterLevel, updateUserAccount: onUpdateUserAccount } = useAppStore();
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [whitelistInput, setWhitelistInput] = useState('');
  const [whitelistSuccess, setWhitelistSuccess] = useState<string | null>(null);
  const [isUpdatingGravity, setIsUpdatingGravity] = useState(false);
  const [selectedFilterCategory, setSelectedFilterCategory] = useState<string>('All');
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [ripples, setRipples] = useState<{id: number, colorClass: string}[]>([]);

  const navScrollRef = useRef<HTMLDivElement>(null);
  const isNavDragging = useRef(false);
  const navStartX = useRef(0);
  const navScrollLeft = useRef(0);

  const handleNavMouseDown = useCallback((e: React.MouseEvent) => {
    if (!navScrollRef.current) return;
    isNavDragging.current = false;
    navStartX.current = e.pageX - navScrollRef.current.offsetLeft;
    navScrollLeft.current = navScrollRef.current.scrollLeft;
  }, []);

  const handleNavMouseLeave = useCallback(() => {
    isNavDragging.current = false;
  }, []);

  const handleNavMouseUp = useCallback(() => {
    // Reset drag state slightly after the click event would fire
    // This prevents the state from getting stuck if mouseup happens outside a button
    setTimeout(() => {
      isNavDragging.current = false;
    }, 50);
  }, []);

  const handleNavMouseMove = useCallback((e: React.MouseEvent) => {
    if (!navScrollRef.current || e.buttons !== 1) return;
    e.preventDefault();
    const x = e.pageX - navScrollRef.current.offsetLeft;
    const walk = (x - navStartX.current);
    if (Math.abs(walk) > 5) {
      isNavDragging.current = true;
    }
    navScrollRef.current.scrollLeft = navScrollLeft.current - walk;
  }, []);

  const handleTabClick = (tabId: string, e: React.MouseEvent) => {
    if (isNavDragging.current) {
      e.preventDefault();
      e.stopPropagation();
      isNavDragging.current = false;
      return;
    }
    setActiveTab(tabId);
  };

const handleWhitelistSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!whitelistInput.trim()) return;
    onAddWhitelistDomain(whitelistInput.trim());
    setWhitelistSuccess(`Added '${whitelistInput.trim()}'`);
    setWhitelistInput('');
    setTimeout(() => setWhitelistSuccess(null), 4000);
  };

  const triggerGravityUpdate = () => {
    setIsUpdatingGravity(true);
    onRefreshGravity();
    setTimeout(() => setIsUpdatingGravity(false), 2500);
  };

  const cycleFilterLevel = () => {
    const levels: Array<'none' | 'low' | 'medium' | 'high'> = ['none', 'low', 'medium', 'high'];
    const currentIndex = levels.indexOf(telemetry.filterLevel);
    const nextIndex = (currentIndex + 1) % levels.length;
    onChangeFilterLevel(levels[nextIndex]);
  };

  
  const handleShieldClick = () => {
    cycleFilterLevel();
    // Use the NEXT filter level color for the ripple so it feels responsive
    const levels = ['none', 'low', 'medium', 'high'];
    const nextIndex = (levels.indexOf(telemetry.filterLevel) + 1) % levels.length;
    setRipples(prev => [...prev, { id: Date.now(), colorClass: getFilterColor(levels[nextIndex]) }]);
  };

  const getFilterLevelLabel = (level: string) => {
    switch (level) {
      case 'none': return 'Off';
      case 'low': return 'Eco';
      case 'medium': return 'Active';
      case 'high': return 'Ionity Full Protection';
      default: return 'Unknown';
    }
  };

  const chartData = useMemo(() => [
    { time: '00:00', total: 1200, blocked: 450 },
    { time: '04:00', total: 800, blocked: 310 },
    { time: '08:00', total: 2400, blocked: 910 },
    { time: '12:00', total: 6800, blocked: 2520 },
    { time: '16:00', total: 9500, blocked: 3510 },
    { time: '20:00', total: 8200, blocked: 3040 },
    { time: '24:00', total: 11200, blocked: 4150 },
  ], []);

  const categoryBreakdown = useMemo(() => [
    { name: 'Ad Trackers', count: 5820, color: '#0ea5e9' },
    { name: 'Telemetry', count: 4210, color: '#38bdf8' },
    { name: 'Malware', count: 2190, color: '#f43f5e' },
    { name: 'Phishing', count: 1240, color: '#f59e0b' },
  ], []);

  const filteredLogs = useMemo(() => {
    return selectedFilterCategory === 'All'
      ? threatLogs
      : threatLogs.filter(log => log.category === selectedFilterCategory);
  }, [selectedFilterCategory, threatLogs]);

  const baseTabs = [
    { id: 'dashboard', icon: Activity, label: 'Dash' },
    { id: 'shield', icon: ShieldCheck, label: 'Shield' },
    { id: 'threats', icon: ShieldAlert, label: 'Threats' },
    { id: 'clients', icon: Smartphone, label: 'Clients' },
    { id: 'terminal', icon: Terminal, label: 'Terminal' },
    { id: 'game', icon: Gamepad2, label: 'Game' },
  ];

  const dynamicTabs = activeModules.map(moduleId => {
    const config = SECURITY_MODULES.find(m => m.id === moduleId);
    return {
      id: moduleId,
      icon: Zap, // Using Zap for dynamic modules
      label: config ? config.title.split(' ')[0] : 'Module' // short label
    };
  });

  const TABS = [...baseTabs, ...dynamicTabs, { id: 'settings', icon: SlidersHorizontal, label: 'Settings' }];

  React.useEffect(() => {
    const validTabs = ['dashboard', 'shield', 'threats', 'clients', 'terminal', 'game', 'settings'];
    if (!validTabs.includes(activeTab) && !activeModules.includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [activeModules, activeTab]);


  return (
    <div className="flex justify-center items-center h-full w-full py-4 sm:py-8 overflow-hidden bg-sky-50 dark:bg-black/20 transition-colors duration-500">
      {/* Phone Frame Simulator */}
      <div className="relative w-full max-w-[400px] h-[800px] max-h-full bg-slate-50 dark:bg-black rounded-[40px] shadow-2xl border-[8px] border-sky-200 dark:border-[#1a1a1a] flex flex-col overflow-hidden shrink-0 mx-auto ring-1 ring-black/5 dark:ring-white/10 transition-colors duration-500">
        
        {/* Dynamic Island / Notch area */}
        <div className="absolute top-0 inset-x-0 h-7 flex justify-center z-50">
            <div className="w-32 h-6 bg-slate-300 dark:bg-[#1a1a1a] rounded-b-3xl transition-colors duration-500"></div>
        </div>

        {/* Status Bar */}
        <div className="flex justify-between items-center px-6 pt-3 pb-2 text-[10px] font-mono text-sky-950 dark:text-white z-40 relative transition-colors duration-500">
            <span>{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            <div className="flex items-center gap-1.5">
                <Wifi className="w-3 h-3" />
                <Activity className="w-3 h-3" />
            </div>
        </div>

        <div className="absolute inset-0 bg-slate-50 dark:bg-[#020617] transition-colors duration-500 z-0">
          <LiveBackground level={telemetry.filterLevel} theme={userAccount.appTheme} />
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto no-scrollbar pb-32 relative z-10 transition-colors duration-500">
            {/* Header Area */}
            <div className="px-6 py-6 border-b border-black/5 dark:border-white/5 bg-white/60 dark:bg-black/20 sticky top-0 z-30 backdrop-blur-md transition-colors duration-500">
                <h1 className="text-2xl font-display font-light text-sky-950 dark:text-white tracking-tight mb-1 transition-colors duration-500">
                Node <span className="font-bold">App</span>
                </h1>
                <p className="text-[10px] font-mono text-slate-500 dark:text-slate-400 transition-colors duration-500">
                {userAccount.deviceNickname} &mdash; Mobile View
                </p>
                {/* The customer-facing surface. If any figure below is
                    generated rather than measured, they see it here first. */}
                <div className="mt-3">
                  <DataSourceBanner />
                </div>
            </div>

            <div className="p-4 relative">
                <AnimatePresence mode="wait">
                {activeTab === 'shield' && (
                    <motion.div
                    key="shield"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col items-center justify-center h-[500px]"
                    >
                      <button 
                        onClick={handleShieldClick}
                        className="relative group focus:outline-none transition-transform active:scale-95 duration-75"
                      >
                        <div className="relative flex items-center justify-center w-[280px] h-[300px]">
                            {/* Pulsing Outer Glow matched to shield shape using filter */}
                            <motion.svg 
                              animate={{ filter: ['drop-shadow(0 0 8px currentColor)', 'drop-shadow(0 0 24px currentColor)', 'drop-shadow(0 0 8px currentColor)'] }}
                              transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                              className={cn("absolute w-[85%] h-[85%] transition-all duration-700 opacity-40", getFilterColor(telemetry.filterLevel))} 
                              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"
                            >
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeWidth="0.25" />
                            </motion.svg>
                            
                            
                            {/* True Ripple Effect on click */}
                            <AnimatePresence>
                                {ripples.map(r => (
                                    <motion.div
                                        key={r.id}
                                        initial={{ scale: 0.8, opacity: 0.5 }}
                                        animate={{ scale: 1.5, opacity: 0 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.6, ease: "easeOut" }}
                                        onAnimationComplete={() => setRipples(prev => prev.filter(x => x.id !== r.id))}
                                        className={cn("absolute inset-0 rounded-full", r.colorClass)}
                                        style={{ backgroundColor: 'currentColor' }}
                                    />
                                ))}
                            </AnimatePresence>

                            {/* Layer 1: Very subtle background shield */}
                            <svg className={cn("absolute w-[85%] h-[85%] transition-all duration-700 opacity-[0.02] dark:opacity-[0.05]", getFilterColor(telemetry.filterLevel))} viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            
                            {/* Layer 2: Main Shield Outline - Thinner */}
                            <svg className={cn("absolute w-[85%] h-[85%] transition-all duration-700 drop-shadow-md", getFilterColor(telemetry.filterLevel))} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeWidth="0.25" />
                                <path d="M12 21s7-3.5 7-9.2V5.8L12 3.3 5 5.8v6.5C5 17.5 12 21 12 21z" strokeWidth="0.2" className="opacity-60" />
                            </svg>

                            {/* Layer 3: High-tech grid lines - Thinner */}
                             <svg className={cn("absolute w-[75%] h-[75%] transition-all duration-700 opacity-30", getFilterColor(telemetry.filterLevel))} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 4v16" strokeDasharray="1 3"/>
                                <path d="M6 10h12" strokeDasharray="1 3"/>
                                <circle cx="12" cy="10" r="1.5" />
                            </svg>
                            
                            {/* IONITY Logo Perfectly Centered Inside */}
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none mt-2">
                               <span className={cn("text-3xl font-display font-black tracking-[0.2em] transition-colors duration-500", getFilterColor(telemetry.filterLevel))}>IONITY</span>
                            </div>
                        </div>
                      </button>
                      
                      <div className="mt-8 text-center z-10">
                        <h2 className="text-sm font-mono text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 transition-colors duration-500">Protection Level</h2>
                        <div className={cn("text-3xl font-display font-bold transition-all duration-700", getFilterColor(telemetry.filterLevel))}>
                          {getFilterLevelLabel(telemetry.filterLevel)}
                        </div>
                      </div>
                    </motion.div>
                )}

                {activeTab === 'dashboard' && (
                    <motion.div
                    key="dashboard"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                    >
                        <GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 h-[280px] flex flex-col">
                            <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h3 className="text-sm font-display font-medium text-slate-900 dark:text-white">DNS Traffic</h3>
                                    <p className="text-[10px] font-mono text-slate-400 mt-0.5">24h volume</p>
                                </div>
                                <div className="flex flex-col items-end gap-1 text-[9px] font-mono">
                                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-sky-500" /> Requests</div>
                                    <div className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-rose-500" /> Blocked</div>
                                </div>
                            </div>
                            <div className="flex-1 min-h-0 -ml-4">
                                <Suspense fallback={<InlineFallback label="Loading chart" />}>
                                    <DNSTrafficChart data={chartData} theme={userAccount.appTheme} />
                                </Suspense>
                            </div>
                        </GlassPanel>

                        <div className="grid grid-cols-2 gap-3">
                        {[
                            { label: 'Total Queries', value: telemetry.totalQueriesToday.toLocaleString(), icon: Activity, color: 'text-sky-400' },
                            { label: 'Neutralized', value: telemetry.queriesBlockedToday.toLocaleString(), icon: ShieldAlert, color: 'text-rose-400' },
                            { label: 'Block Rate', value: `${telemetry.blockPercentage}%`, icon: Layers, color: 'text-emerald-400' },
                            { label: 'Gravity Size', value: `${(telemetry.domainsOnGravity / 1000000).toFixed(1)}M`, icon: ShieldCheck, color: 'text-indigo-400' },
                        ].map((stat, i) => (
                            <GlassPanel filterLevel={telemetry.filterLevel} key={i} className="group rounded-2xl p-4 flex flex-col justify-between">
                                <stat.icon className={cn("w-4 h-4 mb-3", stat.color)} />
                                <div>
                                    <div className="text-xl font-mono font-medium text-slate-900 dark:text-white tracking-tight">{stat.value}</div>
                                    <div className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mt-1">{stat.label}</div>
                                </div>
                            </GlassPanel>
                        ))}
                        </div>

                        <GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 h-[400px] flex flex-col overflow-hidden shadow-xl">
                            {/* Subtle High-Tech Grid inside */}
                            <div className="absolute inset-0 bg-[linear-gradient(to_right,#00000005_1px,transparent_1px),linear-gradient(to_bottom,#00000005_1px,transparent_1px)] dark:bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:1rem_1rem] pointer-events-none z-0" />
                            
                            <div className="relative z-10 flex-1 flex flex-col justify-between">
                                {/* Header */}
                                <div className="flex justify-between items-start mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-black/50 border border-slate-100 dark:border-white/10 flex items-center justify-center">
                                            <ShieldCheck className={cn("w-4 h-4", getFilterColor(telemetry.filterLevel))} />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-display font-bold text-slate-900 dark:text-white leading-tight">Gravity Engine</h3>
                                            <p className="text-[9px] font-mono text-slate-400 uppercase tracking-widest">Core Telemetry</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-white/10 rounded-lg">
                                        <span className={cn("w-1.5 h-1.5 rounded-full", telemetry.protectionStatus === 'active' ? "bg-emerald-500 animate-pulse" : "bg-rose-500")} />
                                        <span className={cn("text-[9px] font-mono font-bold uppercase", telemetry.protectionStatus === 'active' ? "text-emerald-500" : "text-rose-500")}>
                                            {telemetry.protectionStatus === 'active' ? 'Active' : 'Offline'}
                                        </span>
                                    </div>
                                </div>
                                
                                {/* Gravity Animation Canvas */}
                                <div className="flex-1 w-full relative mb-4">
                                    <Suspense fallback={<InlineFallback label="Loading gravity field" />}>
                                        <GravityParticleCanvas
                                            isPaused={telemetry.protectionStatus !== 'active'}
                                            threatFeed={threatLogs.map((t) => t.domain).filter(Boolean)}
                                            blockPercentage={telemetry.blockPercentage}
                                        />
                                    </Suspense>
                                </div>
                                
                                {/* Stats Grid */}
                                <div className="grid grid-cols-2 gap-2 mt-auto">
                                    <div className="bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-white/5 rounded-xl p-3 flex flex-col justify-center relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-sky-500/5 to-transparent opacity-5 group-hover:opacity-100 transition-opacity" />
                                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-1 relative z-10">Index Size</span>
                                        <div className="flex items-baseline gap-1 relative z-10">
                                            <span className="text-xl font-mono font-bold text-slate-900 dark:text-white tracking-tight">
                                                {(telemetry.domainsOnGravity / 1000000).toFixed(1)}
                                            </span>
                                            <span className="text-[10px] font-mono text-slate-500 font-medium">M</span>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-black/40 border border-slate-100 dark:border-white/5 rounded-xl p-3 flex flex-col justify-center relative overflow-hidden group">
                                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 to-transparent opacity-5 group-hover:opacity-100 transition-opacity" />
                                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-wider mb-1 relative z-10">Data Saved</span>
                                        <div className="flex items-baseline gap-1 relative z-10">
                                            <span className="text-xl font-mono font-bold text-slate-900 dark:text-white tracking-tight">
                                                {telemetry.dataSavedMB.toFixed(1)}
                                            </span>
                                            <span className="text-[10px] font-mono text-slate-500 font-medium">MB</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </GlassPanel>
                    </motion.div>
                )}

                {activeTab === 'threats' && (
                    <motion.div
                    key="threats"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4 -mt-2"
                    >
                        <GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 h-[200px] flex flex-col">
                            <h3 className="text-sm font-display font-medium text-slate-900 dark:text-white mb-4">Threat Vectors</h3>
                            <div className="flex-1 min-h-0 -ml-4">
                                <Suspense fallback={<InlineFallback label="Loading chart" />}>
                                    <ThreatCategoryChart data={categoryBreakdown} theme={userAccount.appTheme} />
                                </Suspense>
                            </div>
                        </GlassPanel>

                        <GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-black/5 dark:border-white/5">
                                <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                                {['All', 'Telemetry', 'Ad Tracker', 'Phishing'].map((cat) => (
                                    <button
                                    key={cat}
                                    onClick={() => setSelectedFilterCategory(cat)}
                                    className={cn(
                                        "px-3 py-1 rounded-full text-[10px] font-mono transition-all whitespace-nowrap active:scale-95",
                                        selectedFilterCategory === cat 
                                        ? "bg-slate-900 text-slate-900 dark:text-white dark:bg-white dark:text-black font-bold" 
                                        : "bg-black/5 dark:bg-white/5 text-slate-500 dark:text-slate-400"
                                    )}
                                    >
                                    {cat}
                                    </button>
                                ))}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 space-y-2 no-scrollbar">
                                {(showAllLogs ? filteredLogs : filteredLogs.slice(0, 3)).map((log) => (
                                <div key={log.id} className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", log.action === 'Blocked' ? "bg-rose-500" : "bg-emerald-500")} />
                                            <span className="font-mono text-xs font-medium text-slate-900 dark:text-white truncate block">{log.domain}</span>
                                        </div>
                                        <div className="text-[9px] font-mono text-slate-500 truncate ml-3.5">
                                            {log.clientName} &bull; {log.category}
                                        </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                        <div className="text-[9px] font-mono text-slate-500 mb-0.5">{log.timestamp}</div>
                                        <div className={cn("text-[9px] font-bold uppercase", log.action === 'Blocked' ? "text-rose-500 dark:text-rose-400" : "text-emerald-500 dark:text-emerald-400")}>
                                            {log.action}
                                        </div>
                                    </div>
                                </div>
                                ))}
                                
                                {filteredLogs.length > 3 && (
                                    <button 
                                      onClick={() => setShowAllLogs(!showAllLogs)}
                                      className="w-full py-3 mt-2 flex items-center justify-center gap-1.5 text-[10px] font-mono text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors"
                                    >
                                      {showAllLogs ? (
                                        <>Show Less <ChevronUp className="w-3.5 h-3.5" /></>
                                      ) : (
                                        <>Show More ({filteredLogs.length - 3}) <ChevronDown className="w-3.5 h-3.5" /></>
                                      )}
                                    </button>
                                )}
                            </div>
                        </GlassPanel>
                    </motion.div>
                )}

                {activeTab === 'clients' && (
                    <motion.div
                    key="clients"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                    >
                    <GlassPanel filterLevel={telemetry.filterLevel} className="p-5 rounded-3xl flex justify-between items-center">
                        <div>
                        <h3 className="text-sm font-display font-medium text-slate-900 dark:text-white">Active Nodes</h3>
                        <p className="text-[10px] font-mono text-slate-400 mt-1">Zero-Touch Enabled</p>
                        </div>
                        <div className="text-2xl font-display font-light text-sky-400">
                        {clients.length} <span className="text-[10px] text-slate-500 block text-right mt-1">Connected</span>
                        </div>
                    </GlassPanel>

                    <div className="grid grid-cols-1 gap-3">
                        {clients.map(cli => {
                        const IconComp = cli.deviceType === 'TV' ? Tv : cli.deviceType === 'Laptop' ? Laptop : cli.deviceType === 'Smartphone' ? Smartphone : Server;
                        return (
                            <GlassPanel filterLevel={telemetry.filterLevel} key={cli.mac} className="rounded-2xl p-4">
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                        <IconComp className="w-4 h-4 text-sky-400" />
                                    </div>
                                    <div>
                                        <div className="text-sm font-medium text-slate-900 dark:text-white">{cli.hostname}</div>
                                        <div className="text-[10px] font-mono text-slate-500">{cli.ip}</div>
                                    </div>
                                </div>
                                <div className="space-y-2 bg-black/20 p-3 rounded-xl">
                                    <div className="flex justify-between items-center text-[10px] font-mono">
                                        <span className="text-slate-500">Queries</span>
                                        <span className="text-sky-400">{cli.queriesToday.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between items-center text-[10px] font-mono">
                                        <span className="text-slate-500">Blocked</span>
                                        <span className="text-rose-400">{cli.blockedToday.toLocaleString()}</span>
                                    </div>
                                </div>
                            </GlassPanel>
                        )
                        })}
                    </div>
                    </motion.div>
                )}

                {activeTab === 'game' && (
                    <motion.div
                    key="game"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="flex flex-col h-[600px] max-h-[70vh]"
                    >
                        <Suspense fallback={<PanelFallback label="Loading Ionicrobes" className="min-h-0" />}>
                            <IonicrobesGame embedded={true} />
                        </Suspense>
                    </motion.div>
                )}

                {activeTab === 'terminal' && (
                    <motion.div
                    key="terminal"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                    >
                        <TerminalView />
                    </motion.div>
                )}
                {activeTab === 'settings' && (
                    <motion.div
                    key="settings"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-4"
                    >
                        <GlassPanel filterLevel={telemetry.filterLevel} className="rounded-3xl p-5 space-y-6">
                            <div>
                            <h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Protection Status</h3>
                            {telemetry.protectionStatus === 'active' ? (
                                <div className="grid grid-cols-3 gap-2">
                                <button onClick={() => onPauseProtection(5)} className="bg-sky-100 dark:bg-white/5 hover:bg-rose-500/10 text-rose-500 dark:text-rose-400 border border-sky-200 dark:border-white/10 py-3 rounded-xl text-[10px] font-medium transition-all">
                                    5m
                                </button>
                                <button onClick={() => onPauseProtection(15)} className="bg-sky-100 dark:bg-white/5 hover:bg-amber-500/10 text-amber-500 dark:text-amber-400 border border-sky-200 dark:border-white/10 py-3 rounded-xl text-[10px] font-medium transition-all">
                                    15m
                                </button>
                                <button onClick={() => onPauseProtection(60)} className="bg-sky-100 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-sky-900 dark:text-slate-300 border border-sky-200 dark:border-white/10 py-3 rounded-xl text-[10px] font-medium transition-all">
                                    1h
                                </button>
                                </div>
                            ) : (
                                <button onClick={onResumeProtection} className="w-full bg-emerald-500 text-white dark:text-black py-3 rounded-xl text-sm font-bold transition-all shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                RESUME
                                </button>
                            )}
                            </div>
                            <div className="h-px w-full bg-sky-100 dark:bg-white/5" />
                            
                                                        {/* Service Manager */}
                            <Suspense fallback={<InlineFallback label="Loading services" className="min-h-[120px]" />}>
                                <SettingsManager />
                            </Suspense>
                            <div className="h-px w-full bg-sky-100 dark:bg-white/5" />
                            <div>
                            <h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">Whitelist</h3>
                            <form onSubmit={handleWhitelistSubmit} className="flex gap-2 flex-col">
                                <input
                                type="text"
                                value={whitelistInput}
                                onChange={(e) => setWhitelistInput(e.target.value)}
                                placeholder="e.g. secure.com"
                                className="w-full bg-sky-50 dark:bg-black/50 border border-sky-200 dark:border-white/10 rounded-xl px-4 py-3 text-xs text-sky-500 dark:text-sky-400 font-mono focus:outline-none focus:border-sky-500/50 placeholder:text-slate-400 dark:placeholder:text-slate-600"
                                />
                                <button type="submit" className="w-full bg-sky-500 text-white dark:text-black py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2">
                                <Plus className="w-3.5 h-3.5" /> Add Domain
                                </button>
                            </form>
                            {whitelistSuccess && (
                                <p className="text-[10px] font-mono text-emerald-400 mt-2 flex items-center gap-1.5">
                                <CheckCircle2 className="w-3 h-3" /> {whitelistSuccess}
                                </p>
                            )}
                            </div>

                            <div className="h-px w-full bg-sky-100 dark:bg-white/5" />

                            <div>
                                <h3 className="text-sm font-display font-medium text-sky-950 dark:text-white mb-3">System</h3>
                                <div className="space-y-2 mb-4">
                                    <button onClick={triggerGravityUpdate} disabled={isUpdatingGravity} className="w-full bg-sky-100 dark:bg-white/5 text-sky-900 dark:text-slate-300 border border-sky-200 dark:border-white/10 py-3 rounded-xl text-[10px] font-medium transition-all flex items-center justify-center gap-2">
                                    <RefreshCw className={cn("w-3 h-3", isUpdatingGravity && "animate-spin")} />
                                    Sync Database
                                    </button>
                                    <button onClick={onRebootDevice} className="w-full bg-sky-100 dark:bg-white/5 text-sky-900 dark:text-slate-300 border border-sky-200 dark:border-white/10 py-3 rounded-xl text-[10px] font-medium transition-all flex items-center justify-center gap-2">
                                    <Power className="w-3 h-3 text-rose-500" /> Reboot Node
                                    </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-4">
                                    <div className="p-3 bg-sky-50 dark:bg-sky-950/50 rounded-xl border border-sky-200 dark:border-slate-800 text-center">
                                        <div className="text-slate-500 uppercase tracking-wider font-bold mb-2 text-[9px]">Defense Level</div>
                                        <select
                                            value={telemetry.filterLevel}
                                            onChange={(e) => onChangeFilterLevel(e.target.value as 'none' | 'low' | 'medium' | 'high')}
                                            className="w-full bg-sky-100 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-sky-500 dark:text-sky-400 font-sans font-bold uppercase tracking-wider focus:outline-none focus:border-sky-500 appearance-none text-center cursor-pointer"
                                        >
                                            <option value="none">Off</option>
                                            <option value="low">Eco</option>
                                            <option value="medium">Active</option>
                                            <option value="high">Ionity Full</option>
                                        </select>
                                    </div>
                                    <div className="p-3 bg-sky-50 dark:bg-sky-950/50 rounded-xl border border-sky-200 dark:border-slate-800 text-center">
                                        <div className="text-slate-500 uppercase tracking-wider font-bold mb-2 text-[9px]">Theme</div>
                                        <select
                                            value={userAccount.appTheme}
                                            onChange={(e) => onUpdateUserAccount({ appTheme: e.target.value as 'light' | 'dark' | 'system' })}
                                            className="w-full bg-sky-100 dark:bg-slate-950 border border-sky-200 dark:border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-sky-500 dark:text-sky-400 font-sans font-bold uppercase tracking-wider focus:outline-none focus:border-sky-500 appearance-none text-center cursor-pointer"
                                        >
                                            <option value="light">Light</option>
                                            <option value="dark">Dark</option>
                                            <option value="system">System</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </GlassPanel>
                    </motion.div>
                )}
                {activeModules.includes(activeTab) && (
                    <Suspense fallback={<PanelFallback label="Loading module" />}>
                        <DynamicModuleTab moduleId={activeTab} />
                    </Suspense>
                )}
                </AnimatePresence>
            </div>
        </div>

        {/* Bottom Tab Bar */}
        <div 
          ref={navScrollRef}
          onMouseDown={handleNavMouseDown}
          onMouseLeave={handleNavMouseLeave}
          onMouseUp={handleNavMouseUp}
          onMouseMove={handleNavMouseMove}
          className="absolute bottom-6 inset-x-6 bg-white/90 dark:bg-black/80 backdrop-blur-xl border border-sky-200 dark:border-white/10 shadow-2xl shadow-sky-900/20 dark:shadow-none rounded-3xl flex overflow-x-auto gap-4 px-4 py-3 snap-x no-scrollbar items-center flex-nowrap shrink-0 z-40 touch-pan-x cursor-grab active:cursor-grabbing select-none"
        >
            {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
                <button
                key={tab.id}
                onClick={(e) => handleTabClick(tab.id, e)}
                className="relative p-1 flex flex-col items-center justify-center min-w-[50px] min-h-[48px] snap-center focus:outline-none shrink-0"
                >
                  <Icon className={cn("w-5 h-5 transition-colors", isActive ? "text-sky-600 dark:text-sky-400" : "text-sky-900/60 dark:text-slate-500")} />
                  <span className={cn("text-[8px] font-sans font-bold uppercase tracking-wider mt-1 transition-colors", isActive ? "text-sky-600 dark:text-sky-400" : "text-sky-900/60 dark:text-slate-500")}>
                    {tab.label || tab.id}
                  </span>
                  {isActive && (
                      <motion.div
                      layoutId="mobile-dash-indicator"
                      className="absolute bottom-0 w-1 h-1 rounded-full bg-sky-500 dark:bg-sky-400"
                      transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
                      />
                  )}
                </button>
            )
            })}
        </div>

      </div>
    </div>
  );
};
