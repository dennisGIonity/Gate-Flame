const fs = require('fs');

const code = `import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SystemTelemetry, ThreatLogEntry, ConnectedClient, IonityUserAccount } from '../types';
import { INITIAL_TELEMETRY, MOCK_THREAT_LOGS, MOCK_CLIENTS, INITIAL_USER_ACCOUNT } from '../data/mockData';

interface AppState {
  telemetry: SystemTelemetry;
  threatLogs: ThreatLogEntry[];
  clients: ConnectedClient[];
  userAccount: IonityUserAccount;
  
  setTelemetry: (updater: SystemTelemetry | ((prev: SystemTelemetry) => SystemTelemetry)) => void;
  setThreatLogs: (updater: ThreatLogEntry[] | ((prev: ThreatLogEntry[]) => ThreatLogEntry[])) => void;
  setUserAccount: (updater: IonityUserAccount | ((prev: IonityUserAccount) => IonityUserAccount)) => void;
  
  pauseProtection: (durationMinutes: number) => void;
  resumeProtection: () => void;
  addWhitelistDomain: (domain: string) => void;
  refreshGravity: () => void;
  rebootDevice: () => void;
  changeFilterLevel: (level: 'none' | 'low' | 'medium' | 'high') => void;
  updateUserAccount: (updated: Partial<IonityUserAccount>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      telemetry: INITIAL_TELEMETRY,
      threatLogs: MOCK_THREAT_LOGS,
      clients: MOCK_CLIENTS,
      userAccount: INITIAL_USER_ACCOUNT,

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
        const timeStr = \`\${String(now.getHours()).padStart(2, '0')}:\${String(now.getMinutes()).padStart(2, '0')}:\${String(now.getSeconds()).padStart(2, '0')}\`;
        const newLog: ThreatLogEntry = {
          id: \`log-\${Date.now()}\`,
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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ 
        telemetry: { ...state.telemetry, filterLevel: state.telemetry.filterLevel }, 
        userAccount: { ...state.userAccount, appTheme: state.userAccount.appTheme }
      }),
    }
  )
);
`;

fs.writeFileSync('src/store/useAppStore.ts', code);
