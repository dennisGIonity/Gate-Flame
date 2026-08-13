import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SystemTelemetry, ThreatLogEntry, ConnectedClient, IonityUserAccount } from '../types';
import { INITIAL_TELEMETRY, MOCK_THREAT_LOGS, MOCK_CLIENTS, INITIAL_USER_ACCOUNT } from '../data/mockData';

interface AppState {
  telemetry: SystemTelemetry;
  threatLogs: ThreatLogEntry[];
  clients: ConnectedClient[];
  userAccount: IonityUserAccount;
  activeModules: string[];
  
  setTelemetry: (updater: SystemTelemetry | ((prev: SystemTelemetry) => SystemTelemetry)) => void;
  setThreatLogs: (updater: ThreatLogEntry[] | ((prev: ThreatLogEntry[]) => ThreatLogEntry[])) => void;
  setUserAccount: (updater: IonityUserAccount | ((prev: IonityUserAccount) => IonityUserAccount)) => void;
  
  toggleModule: (moduleId: string, enable: boolean) => void;
  pauseProtection: (durationMinutes: number) => void;
  resumeProtection: () => void;
  addWhitelistDomain: (domain: string) => void;
  refreshGravity: () => void;
  rebootDevice: () => void;
  changeFilterLevel: (level: 'none' | 'low' | 'medium' | 'high') => void;
  updateUserAccount: (updated: Partial<IonityUserAccount>) => void;
}


const safeStorage = {
  getItem: (name: string) => {
    try { 
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(name); 
      }
    } catch (e) { console.warn('Storage access blocked', e); }
    return null;
  },
  setItem: (name: string, value: string) => {
    try { 
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(name, value); 
      }
    } catch (e) {}
  },
  removeItem: (name: string) => {
    try { 
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(name); 
      }
    } catch (e) {}
  }
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      telemetry: INITIAL_TELEMETRY,
      threatLogs: MOCK_THREAT_LOGS,
      clients: MOCK_CLIENTS,
      userAccount: INITIAL_USER_ACCOUNT,
      activeModules: [],
      toggleModule: (moduleId, enable) => set((state) => ({ activeModules: enable ? [...new Set([...state.activeModules, moduleId])] : state.activeModules.filter(id => id !== moduleId) })),


      setTelemetry: (updater) => set((state) => ({ 
        telemetry: typeof updater === 'function' ? updater(state.telemetry) : updater 
      })),
      
      setThreatLogs: (updater) => set((state) => ({ 
        threatLogs: typeof updater === 'function' ? updater(state.threatLogs) : updater 
      })),
      
      setUserAccount: (updater) => set((state) => ({ 
        userAccount: typeof updater === 'function' ? updater(state.userAccount) : updater
      })),

      pauseProtection: (durationMinutes: number) => set((state) => ({
        telemetry: {
          ...state.telemetry,
          protectionStatus: 'paused',
          pauseTimeRemainingSeconds: durationMinutes * 60,
        }
      })),

      resumeProtection: () => set((state) => ({
        telemetry: {
          ...state.telemetry,
          protectionStatus: 'active',
          pauseTimeRemainingSeconds: 0,
        }
      })),

      addWhitelistDomain: (domain: string) => set((state) => {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        const newLog: ThreatLogEntry = {
          id: `log-${Date.now()}`,
          timestamp: timeStr,
          domain,
          clientIp: '192.168.1.105',
          clientName: 'Gate^Flame-Node-Primary',
          category: 'Ad Tracker',
          action: 'Whitelisted',
          severity: 'low',
        };
        return { threatLogs: [newLog, ...state.threatLogs] };
      }),

      refreshGravity: () => set((state) => ({
        telemetry: {
          ...state.telemetry,
          domainsOnGravity: state.telemetry.domainsOnGravity + 1420,
        }
      })),

      rebootDevice: () => {
        set((state) => ({
          telemetry: {
            ...state.telemetry,
            protectionStatus: 'initializing',
          }
        }));
        
        setTimeout(() => {
          set((state) => ({
            telemetry: {
              ...state.telemetry,
              protectionStatus: 'active',
            }
          }));
        }, 3000);
      },

      changeFilterLevel: (level: 'none' | 'low' | 'medium' | 'high') => set((state) => ({
        telemetry: {
          ...state.telemetry,
          filterLevel: level,
        }
      })),

      updateUserAccount: (updated: Partial<IonityUserAccount>) => set((state) => ({
        userAccount: { ...state.userAccount, ...updated }
      })),
    }),
    {
      name: 'ionity-app-storage',
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ 
        telemetry: { ...state.telemetry, filterLevel: state.telemetry.filterLevel }, 
        userAccount: { ...state.userAccount, appTheme: state.userAccount.appTheme }
      }),
    }
  )
);
