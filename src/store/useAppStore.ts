import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SystemTelemetry, ThreatLogEntry, ConnectedClient, IonityUserAccount } from '../types';
// Seeds are EMPTY: nulls and empty lists, never plausible numbers. The
// telemetry loop fills them on the first successful poll; until then every
// figure renders as "—" and DataSourceBanner says why. See src/data/seeds.ts.
import { EMPTY_TELEMETRY, DEFAULT_USER_ACCOUNT } from '../data/seeds';

interface AppState {
  telemetry: SystemTelemetry;
  threatLogs: ThreatLogEntry[];
  clients: ConnectedClient[];
  userAccount: IonityUserAccount;
  activeModules: string[];
  
  setTelemetry: (updater: SystemTelemetry | ((prev: SystemTelemetry) => SystemTelemetry)) => void;
  setThreatLogs: (updater: ThreatLogEntry[] | ((prev: ThreatLogEntry[]) => ThreatLogEntry[])) => void;
  setClients: (updater: ConnectedClient[] | ((prev: ConnectedClient[]) => ConnectedClient[])) => void;
  setUserAccount: (updater: IonityUserAccount | ((prev: IonityUserAccount) => IonityUserAccount)) => void;
  
  toggleModule: (moduleId: string, enable: boolean) => void;
  pauseProtection: (durationMinutes: number) => void;
  resumeProtection: () => void;
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
      telemetry: EMPTY_TELEMETRY,
      threatLogs: [],
      clients: [],
      userAccount: DEFAULT_USER_ACCOUNT,
      activeModules: [],
      toggleModule: (moduleId, enable) => set((state) => ({ activeModules: enable ? [...new Set([...state.activeModules, moduleId])] : state.activeModules.filter(id => id !== moduleId) })),


      setTelemetry: (updater) => set((state) => ({ 
        telemetry: typeof updater === 'function' ? updater(state.telemetry) : updater 
      })),
      
      setThreatLogs: (updater) => set((state) => ({
        threatLogs: typeof updater === 'function' ? updater(state.threatLogs) : updater
      })),

      setClients: (updater) => set((state) => ({
        clients: typeof updater === 'function' ? updater(state.clients) : updater
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

      // addWhitelistDomain / refreshGravity / rebootDevice were removed on
      // 2026-09-10. Each wrote a value the node never sent: a threat-log row
      // with a hardcoded IP, +1420 invented gravity domains, and an "active"
      // status three seconds after a reboot that never happened. Nothing in the
      // app called them; the real actions are node routes (/filtering/*,
      // /blocklists/*) driven from the mobile and kiosk screens.

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
