import React from 'react';
import { AppViewMode } from '../../types';
import { ShieldCheck, Smartphone, Cpu, Server, Terminal, Box, Sparkles, Package, ExternalLink, Settings, Bell, Activity } from 'lucide-react';
import { cn } from '../../lib/utils';
import { LiveBackground } from '../LiveBackground';
import { motion } from 'motion/react';
import { DataSourceBanner } from '../DataSourceBanner';

interface AppLayoutProps {
  currentView: AppViewMode;
  onSelectView: (view: AppViewMode) => void;
  protectionActive: boolean;
  totalBlocked: number;
  filterLevel: 'none' | 'low' | 'medium' | 'high';
  appTheme: 'dark' | 'light' | 'system';
  children: React.ReactNode;
}

const NAV_ITEMS = [
  { id: 'mobile_apk', label: 'Mobile Dashboard', icon: Smartphone },
  { id: 'device_kiosk', label: 'Node Kiosk', icon: Cpu },
  { id: 'server_sync', label: 'Server Sync', icon: Server },
  { id: 'container_architecture', label: 'Containers', icon: Box },
  { id: 'scripts_bom', label: 'Scripts & BOM', icon: Terminal },
  { id: 'future_roadmap', label: 'Roadmap', icon: Sparkles },
  { id: 'package_export', label: 'Export App', icon: Package },
] as const;

export const AppLayout: React.FC<AppLayoutProps> = ({
  currentView,
  onSelectView,
  protectionActive,
  totalBlocked,
  filterLevel,
  appTheme,
  children,
}) => {
  return (
    <div className="min-h-screen bg-sky-50 dark:bg-[#050505] text-slate-900 dark:text-slate-100 flex font-sans selection:bg-sky-500/30 selection:text-black dark:text-white relative overflow-hidden">
      {/* Abstract Background Effects */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-50">
        <LiveBackground level={filterLevel} theme={appTheme} />
      </div>
      <div className="absolute top-0 left-1/4 w-[800px] h-[500px] bg-sky-900/10 rounded-full blur-[120px] pointer-events-none -translate-y-1/2" />
      <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[150px] pointer-events-none translate-y-1/3" />
      
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff03_1px,transparent_1px),linear-gradient(to_bottom,#ffffff03_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)]" />

      {/* Sidebar */}
      <aside className="w-64 border-r border-black/5 dark:border-white/5 bg-white/60 dark:bg-black/40 backdrop-blur-xl flex flex-col z-20 shrink-0 relative">
        <div className="p-6 flex items-center gap-3">
          <div className="relative">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-[0_0_20px_rgba(14,165,233,0.3)]">
              <ShieldCheck className="w-5 h-5 text-black dark:text-white" />
            </div>
            {protectionActive && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
            )}
          </div>
          <div className="flex flex-col">
            <span className="font-display font-bold text-lg tracking-tight leading-tight">Gate^Flame</span>
            <span className="text-[10px] text-slate-600 dark:text-slate-500 font-mono tracking-widest uppercase">Node Agent</span>
          </div>
        </div>

        <div className="px-4 py-2">
          <div className="text-xs font-mono text-slate-600 dark:text-slate-500 mb-3 px-2">Navigation</div>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectView(item.id as AppViewMode)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all relative overflow-hidden group",
                    isActive ? "text-black dark:text-white" : "text-slate-400 hover:text-slate-200 hover:bg-black/5 dark:bg-white/5"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 bg-black/10 dark:bg-white/10 rounded-lg"
                      initial={false}
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                    />
                  )}
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-1/2 bg-sky-400 rounded-r-full" />
                  )}
                  <Icon className={cn("w-4 h-4 relative z-10", isActive ? "text-sky-400" : "text-slate-600 dark:text-slate-500 group-hover:text-slate-400")} />
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="mt-auto p-6">
          <div className="bg-black/5 dark:bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">Status</span>
              <div className="flex items-center gap-1.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", protectionActive ? "bg-emerald-400" : "bg-rose-500")} />
                <span className={cn("text-[10px] font-bold uppercase", protectionActive ? "text-emerald-400" : "text-rose-500")}>
                  {protectionActive ? "Active" : "Paused"}
                </span>
              </div>
            </div>
            <div className="h-px bg-black/10 dark:bg-white/10" />
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-600 dark:text-slate-500 uppercase tracking-wider font-mono">Blocked Today</span>
              <span className="text-xl font-bold font-mono tracking-tight text-black dark:text-white">{totalBlocked.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 z-10 relative">
        {/* Top Utility Bar */}
        <header className="h-16 border-b border-black/5 dark:border-white/5 bg-white/20 dark:bg-black/20 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-30">
          <div className="flex items-center gap-4 text-xs font-mono text-slate-600 dark:text-slate-500">
            <span className="flex items-center gap-2 px-2 py-1 bg-black/5 dark:bg-white/5 rounded-md border border-black/5 dark:border-white/5">
              <Activity className="w-3.5 h-3.5 text-sky-400" />
              AED-POL-986
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://ionity.co.za/" target="_blank" rel="noreferrer" className="text-xs font-mono text-slate-600 dark:text-slate-500 hover:text-black dark:text-slate-400 dark:hover:text-black dark:text-white transition-colors flex items-center gap-1.5">
              ionity.co.za <ExternalLink className="w-3 h-3" />
            </a>
            <div className="h-4 w-px bg-black/10 dark:bg-white/10" />
            <button className="text-slate-600 dark:text-slate-500 hover:text-black dark:text-slate-400 dark:hover:text-black dark:text-white transition-colors">
              <Bell className="w-4 h-4" />
            </button>
            <button className="text-slate-600 dark:text-slate-500 hover:text-black dark:text-slate-400 dark:hover:text-black dark:text-white transition-colors">
              <Settings className="w-4 h-4" />
            </button>
            <div className="w-8 h-8 rounded-full border border-white/10 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center shadow-inner ml-2">
              <span className="text-xs font-bold text-slate-300">IO</span>
            </div>
          </div>
        </header>

        {/* Data-source honesty banner. Sits above every view, deliberately:
            if anything on screen is simulated, the user is told before they
            read it, not after. See src/components/DataSourceBanner.tsx. */}
        <div className="px-8 pt-4">
          <div className="max-w-7xl mx-auto">
            <DataSourceBanner />
          </div>
        </div>

        {/* Dynamic View Content */}
        <div className="flex-1 overflow-y-auto p-8 pt-4 relative">
          <motion.div
            key={currentView}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="h-full w-full max-w-7xl mx-auto"
          >
            {children}
          </motion.div>
        </div>
      </main>
    </div>
  );
};
