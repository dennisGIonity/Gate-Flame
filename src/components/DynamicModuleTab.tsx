import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { SECURITY_MODULES } from '../services/serviceManager';
import { Activity, Shield, Network, Server, Zap, Lock, Cpu, Globe, Target } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useAppStore } from '../store/useAppStore';

export const DynamicModuleTab: React.FC<{ moduleId: string }> = ({ moduleId }) => {
  const moduleConfig = SECURITY_MODULES.find((m) => m.id === moduleId);
  const { userAccount } = useAppStore();
  const isDark = userAccount.appTheme === 'dark' || (userAccount.appTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [stats, setStats] = useState({ metric1: 0, metric2: 0, metric3: 0 });
  const [dummyData, setDummyData] = useState(() => Array.from({ length: 20 }).map((_, i) => ({
    time: `${i * 2}s`,
    value1: Math.floor(Math.random() * 50) + 20,
    value2: Math.floor(Math.random() * 30) + 10,
  })));

  useEffect(() => {
    const interval = setInterval(() => {
      setStats({
        metric1: Math.floor(Math.random() * 1000),
        metric2: Math.floor(Math.random() * 50) + 10,
        metric3: Math.floor(Math.random() * 100)
      });
      setDummyData(prev => {
        const newData = [...prev.slice(1)];
        const lastTimeMatch = newData[newData.length - 1].time.match(/(\d+)/);
        const lastTime = lastTimeMatch ? parseInt(lastTimeMatch[1]) + 2 : 40;
        newData.push({
          time: `${lastTime}s`,
          value1: Math.floor(Math.random() * 50) + 20,
          value2: Math.floor(Math.random() * 30) + 10,
        });
        return newData;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [moduleId]);

  if (!moduleConfig) return null;

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
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 bg-emerald-100 dark:bg-blue-900/30 text-emerald-700 dark:text-blue-300 text-[9px] font-mono rounded border border-emerald-200 dark:border-blue-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 dark:bg-blue-400 animate-pulse"></span>
              SERVICE ACTIVE
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 shrink-0">
        {[
          { label: 'Packets / Actions', value: stats.metric1.toString(), icon: Activity },
          { label: 'Threats / Flags', value: stats.metric2.toString(), icon: Shield },
          { label: 'Connections', value: '891', icon: Network },
          { label: 'Uptime', value: '99.9%', icon: Server },
        ].map((stat, i) => (
          <div key={i} className="bg-white dark:bg-blue-900/20 border border-slate-200 dark:border-blue-500/50 rounded-2xl p-4 flex flex-col justify-between shadow-sm">
             <stat.icon className="w-4 h-4 mb-3 text-sky-500 dark:text-blue-400" />
             <div>
                 <div className="text-xl font-mono font-medium text-slate-900 dark:text-blue-100 tracking-tight">{stat.value}</div>
                 <div className="text-[9px] font-mono text-slate-400 dark:text-blue-400/60 uppercase tracking-wider mt-1">{stat.label}</div>
             </div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-blue-900/20 border border-slate-200 dark:border-blue-500/50 rounded-3xl p-5 shrink-0 flex flex-col shadow-sm h-[200px]">
        <div className="flex justify-between items-start mb-4">
            <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-blue-300">Live Telemetry Flow</h3>
                <p className="text-[10px] font-mono text-slate-400 dark:text-blue-400/70 mt-0.5 uppercase tracking-widest">Real-time Analysis</p>
            </div>
        </div>
        <div className="flex-1 min-h-0 -ml-4">
           <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dummyData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
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
        <div className="space-y-1 relative z-0 flex flex-col justify-end h-full">
            <p>&gt; [API] Listening on {moduleConfig.apiEndpoint}</p>
            <p>&gt; Initializing hooks in kernel space...</p>
            <p>&gt; Status: OK. Allocating buffers...</p>
            <p>&gt; Metric {stats.metric3} routed successfully.</p>
        </div>
      </div>
    </motion.div>
  );
};
