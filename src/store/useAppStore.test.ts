/**
 * Gate^Flame — useAppStore tests.
 *
 * Two things are under test here and they are not the same thing:
 *
 *  1. The actions. Each one is the only place a given piece of state changes,
 *     so each one gets asserted on its actual effect rather than on "it ran".
 *
 *  2. The persistence contract around the key `ionity-app-storage`. That key is
 *     not private to this module: index.html reads it synchronously in a
 *     <script> before React boots, to apply the dark class and
 *     data-filter-level without a flash. It reaches in at
 *     `state.state.userAccount.appTheme` and `state.state.telemetry.filterLevel`.
 *     If `partialize` or the envelope shape ever changes, that inline script
 *     silently stops working and the app flashes the wrong theme on every load
 *     — with no error anywhere. So the stored *shape* is asserted explicitly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './useAppStore';
import { DEFAULT_USER_ACCOUNT, EMPTY_TELEMETRY } from '../data/seeds';
import type { ThreatLogEntry } from '../types';

/** Two real-shaped rows so list behaviour can be asserted against something. */
const SEED_LOGS: ThreatLogEntry[] = [
  {
    id: 'seed-1',
    timestamp: '10:00:00',
    domain: 'tracker.example',
    clientIp: '10.0.0.2',
    clientName: 'Laptop',
    category: 'Ad Tracker',
    action: 'Blocked',
    severity: 'high',
  },
  {
    id: 'seed-2',
    timestamp: '10:00:01',
    domain: 'cdn.example',
    clientIp: '10.0.0.3',
    clientName: 'Phone',
    category: 'Telemetry',
    action: 'Blocked',
    severity: 'low',
  },
];
// Seeds with a measured value so "left untouched" assertions are meaningful.
const INITIAL_TELEMETRY = { ...EMPTY_TELEMETRY, totalQueriesToday: 100, domainsOnGravity: 5000, protectionStatus: 'active' as const };
const INITIAL_USER_ACCOUNT = { ...DEFAULT_USER_ACCOUNT, email: 'owner@example.test', deviceNickname: 'Test Node' };

const STORAGE_KEY = 'ionity-app-storage';

/** The persisted envelope zustand writes: { state, version }. */
interface Persisted {
  version: number;
  state: {
    telemetry: { filterLevel: string };
    userAccount: { appTheme: string };
  };
}

const readPersisted = (): Persisted => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) throw new Error(`nothing stored under ${STORAGE_KEY}`);
  return JSON.parse(raw) as Persisted;
};

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState({
      telemetry: { ...INITIAL_TELEMETRY },
      threatLogs: [...SEED_LOGS],
      clients: [],
      userAccount: { ...INITIAL_USER_ACCOUNT },
      activeModules: [],
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('module toggling', () => {
    it('adds a module, and adding it twice does not duplicate it', () => {
      useAppStore.getState().toggleModule('ids-suricata', true);
      useAppStore.getState().toggleModule('ids-suricata', true);

      expect(useAppStore.getState().activeModules).toEqual(['ids-suricata']);
    });

    it('removes only the named module', () => {
      const { toggleModule } = useAppStore.getState();
      toggleModule('ids-suricata', true);
      toggleModule('firewall', true);
      toggleModule('ids-suricata', false);

      expect(useAppStore.getState().activeModules).toEqual(['firewall']);
    });
  });

  describe('protection state', () => {
    it('pauseProtection stores the duration in seconds, not minutes', () => {
      useAppStore.getState().pauseProtection(15);

      const { protectionStatus, pauseTimeRemainingSeconds } = useAppStore.getState().telemetry;
      expect(protectionStatus).toBe('paused');
      expect(pauseTimeRemainingSeconds).toBe(900);
    });

    it('resumeProtection clears the remaining pause time as well as the status', () => {
      useAppStore.getState().pauseProtection(15);
      useAppStore.getState().resumeProtection();

      expect(useAppStore.getState().telemetry).toMatchObject({
        protectionStatus: 'active',
        pauseTimeRemainingSeconds: 0,
      });
    });

    it('leaves the rest of telemetry untouched when pausing', () => {
      useAppStore.getState().pauseProtection(1);

      const t = useAppStore.getState().telemetry;
      expect(t.totalQueriesToday).toBe(INITIAL_TELEMETRY.totalQueriesToday);
      expect(t.domainsOnGravity).toBe(INITIAL_TELEMETRY.domainsOnGravity);
    });

  });

  it('changeFilterLevel replaces only filterLevel', () => {
    useAppStore.getState().changeFilterLevel('low');

    expect(useAppStore.getState().telemetry.filterLevel).toBe('low');
    expect(useAppStore.getState().telemetry.protectionStatus).toBe(
      INITIAL_TELEMETRY.protectionStatus,
    );
  });

  it('updateUserAccount merges rather than replaces', () => {
    useAppStore.getState().updateUserAccount({ appTheme: 'dark' });

    const account = useAppStore.getState().userAccount;
    expect(account.appTheme).toBe('dark');
    expect(account.email).toBe(INITIAL_USER_ACCOUNT.email);
    expect(account.deviceNickname).toBe(INITIAL_USER_ACCOUNT.deviceNickname);
  });

  describe('setters accept a value or an updater', () => {
    it('setTelemetry with a plain value replaces telemetry wholesale', () => {
      const next = { ...INITIAL_TELEMETRY, totalQueriesToday: 1 };
      useAppStore.getState().setTelemetry(next);

      expect(useAppStore.getState().telemetry.totalQueriesToday).toBe(1);
    });

    it('setTelemetry with a function receives the previous value', () => {
      useAppStore.getState().setTelemetry((prev) => ({
        ...prev,
        totalQueriesToday: (prev.totalQueriesToday ?? 0) + 5,
      }));

      expect(useAppStore.getState().telemetry.totalQueriesToday).toBe(
        INITIAL_TELEMETRY.totalQueriesToday + 5,
      );
    });

    it('setThreatLogs and setClients accept updaters too', () => {
      useAppStore.getState().setThreatLogs((prev) => prev.slice(0, 1));
      useAppStore.getState().setClients([]);

      expect(useAppStore.getState().threatLogs).toHaveLength(1);
      expect(useAppStore.getState().clients).toEqual([]);
    });
  });

  describe('localStorage persistence under ionity-app-storage', () => {
    it('writes the two fields index.html reads, at the paths it reads them from', () => {
      useAppStore.getState().changeFilterLevel('medium');
      useAppStore.getState().updateUserAccount({ appTheme: 'dark' });

      const stored = readPersisted();
      // Exactly the access paths used by the inline <script> in index.html.
      expect(stored.state.userAccount.appTheme).toBe('dark');
      expect(stored.state.telemetry.filterLevel).toBe('medium');
    });

    it('persists only telemetry and userAccount — never logs, clients or modules', () => {
      useAppStore.getState().setThreatLogs([...SEED_LOGS]);
      useAppStore.getState().toggleModule('firewall', true);

      const stored = readPersisted();
      expect(Object.keys(stored.state).sort()).toEqual(['telemetry', 'userAccount']);
      expect(JSON.stringify(stored)).not.toContain('tracker.example');
      expect(JSON.stringify(stored)).not.toContain('firewall');
    });

    it('rehydrates filterLevel and appTheme from an existing stored value', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 0,
          state: {
            telemetry: { ...INITIAL_TELEMETRY, filterLevel: 'none' },
            userAccount: { ...INITIAL_USER_ACCOUNT, appTheme: 'light' },
          },
        }),
      );

      // A fresh module registry so the store is constructed against the value
      // that is already in storage, exactly as it is on a real page load.
      vi.resetModules();
      const { useAppStore: rehydrated } = await import('./useAppStore');

      expect(rehydrated.getState().telemetry.filterLevel).toBe('none');
      expect(rehydrated.getState().userAccount.appTheme).toBe('light');
      // Non-persisted slices come back EMPTY, not from storage and not from
      // any seed list — there is no seed list any more.
      expect(rehydrated.getState().threatLogs).toEqual([]);
      expect(rehydrated.getState().clients).toEqual([]);
    });

    it('survives a blocked localStorage instead of throwing into the UI', () => {
      const setItem = vi
        .spyOn(Storage.prototype, 'setItem')
        .mockImplementation(() => {
          throw new DOMException('QuotaExceededError');
        });

      // Safari private browsing / hardened enterprise profiles behave this way.
      // safeStorage swallows it: state must still update in memory.
      expect(() => useAppStore.getState().changeFilterLevel('low')).not.toThrow();
      expect(useAppStore.getState().telemetry.filterLevel).toBe('low');

      setItem.mockRestore();
    });
  });
});
