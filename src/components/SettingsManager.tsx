import React, { useState } from 'react';
import { SECURITY_MODULES, ApiService } from '../services/serviceManager';
import { useAppStore } from '../store/useAppStore';
import { DataSourceBanner, SimulatedBadge } from './DataSourceBanner';

export const SettingsManager: React.FC = () => {
  const activeModules = useAppStore(state => state.activeModules);
  const toggleModule = useAppStore(state => state.toggleModule);
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  // Per-module message from the node: a capability gap, a "recorded only"
  // advisory, or a refusal. Previously every failure was
  // `alert("Failed to engage backend service. Check hardware logs.")`, which
  // named no cause and blocked the UI thread.
  const [notices, setNotices] = useState<Record<string, { kind: 'advisory' | 'error'; text: string }>>({});

  const handleToggle = async (moduleId: string, endpoint: string) => {
    const isCurrentlyActive = activeModules.includes(moduleId);
    const targetState = !isCurrentlyActive;

    setLoadingIds(prev => [...prev, moduleId]);
    setNotices(prev => {
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });

    const result = await ApiService.toggleService(moduleId, endpoint, targetState);

    if (result.ok) {
      toggleModule(moduleId, targetState);
      // Success with a caveat is still a caveat. A firewall bounce recorded
      // with no packet-filter control must not render as an unqualified green.
      if (result.advisory) {
        setNotices(prev => ({ ...prev, [moduleId]: { kind: 'advisory', text: result.advisory as string } }));
      }
    } else {
      // The switch stays where it was. Stopping a module requires kiosk scope
      // by design, so a phone receives a refusal here and is told why.
      setNotices(prev => ({
        ...prev,
        [moduleId]: { kind: 'error', text: result.error ?? 'The node did not accept this change.' },
      }));
    }

    setLoadingIds(prev => prev.filter(id => id !== moduleId));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-display font-medium text-sky-950 dark:text-blue-400 border-b pb-2 dark:border-blue-900/50">
        Active Service Manager
      </h3>

      {/* Toggling a module is the most consequential thing on this screen.
          The user must know whether it will reach real hardware. */}
      <DataSourceBanner />

      <div className="flex flex-col gap-3">
        {SECURITY_MODULES.map((module) => {
          const isActive = activeModules.includes(module.id);
          const isLoading = loadingIds.includes(module.id);

          return (
            <div 
              key={module.id} 
              className={`p-4 rounded-xl border transition-colors ${
                isActive 
                  ? 'bg-white border-sky-200 dark:bg-blue-950/30 dark:border-blue-500/50' 
                  : 'bg-slate-50 border-slate-200 dark:bg-black dark:border-blue-900/30'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div className={`text-xs font-bold pr-4 ${isActive ? 'text-sky-700 dark:text-blue-300' : 'text-slate-700 dark:text-blue-600/70'}`}>
                  {module.title}
                  {isActive && <SimulatedBadge className="ml-2 align-middle" />}
                </div>
                
                {/* Custom Toggle Switch */}
                <button
                  onClick={() => handleToggle(module.id, module.apiEndpoint)}
                  disabled={isLoading}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none ${
                    isActive ? 'bg-sky-500 dark:bg-blue-600' : 'bg-slate-300 dark:bg-blue-950'
                  } ${isLoading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isActive ? 'translate-x-4' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <p className="text-[9px] font-sans text-slate-500 dark:text-blue-400/60 leading-relaxed">
                {module.description}
              </p>

              {notices[module.id] && (
                <div
                  role={notices[module.id].kind === 'error' ? 'alert' : 'status'}
                  className={`mt-2 px-2 py-1.5 rounded-lg text-[9px] font-mono leading-relaxed border ${
                    notices[module.id].kind === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-500/40 text-red-800 dark:text-red-300'
                      : 'bg-amber-50 dark:bg-amber-900/20 border-amber-300 dark:border-amber-500/40 text-amber-900 dark:text-amber-300'
                  }`}
                >
                  {notices[module.id].text}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
