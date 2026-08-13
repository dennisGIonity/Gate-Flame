import React, { useState } from 'react';
import { SECURITY_MODULES, ApiService } from '../services/serviceManager';
import { useAppStore } from '../store/useAppStore';

export const SettingsManager: React.FC = () => {
  const activeModules = useAppStore(state => state.activeModules);
  const toggleModule = useAppStore(state => state.toggleModule);
  const [loadingIds, setLoadingIds] = useState<string[]>([]);

  const handleToggle = async (moduleId: string, endpoint: string) => {
    const isCurrentlyActive = activeModules.includes(moduleId);
    const targetState = !isCurrentlyActive;

    // Set UI to loading state
    setLoadingIds(prev => [...prev, moduleId]);

    // Physically engage backend service
    const success = await ApiService.toggleService(moduleId, endpoint, targetState);

    if (success) {
      toggleModule(moduleId, targetState);
    } else {
      alert("Failed to engage backend service. Check hardware logs.");
    }

    // Remove loading state
    setLoadingIds(prev => prev.filter(id => id !== moduleId));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-display font-medium text-sky-950 dark:text-blue-400 border-b pb-2 dark:border-blue-900/50">
        Active Service Manager
      </h3>
      
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
            </div>
          );
        })}
      </div>
    </div>
  );
};
