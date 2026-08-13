/**
 * Gate^Flame — subscribe to the live/demo connection state.
 *
 * Built on useSyncExternalStore rather than mirrored into the Zustand store on
 * purpose. Connection state is owned by gateflameApi, which is also what
 * mutates it during a fallback; copying it into a second store would create two
 * sources of truth for the one question this whole seam exists to answer —
 * "is what I am looking at real?" — and they would drift.
 */

import { useSyncExternalStore, useCallback } from 'react';
import { gateflameApi } from '../services/gateflameApi';
import type { ConnectionState } from '../types/api';

export const useConnection = (): ConnectionState & { reconnect: () => void } => {
  const state = useSyncExternalStore(
    useCallback((onChange: () => void) => gateflameApi.subscribeConnection(() => onChange()), []),
    () => gateflameApi.getConnection(),
    () => gateflameApi.getConnection(),
  );

  const reconnect = useCallback(() => {
    void gateflameApi.connect();
  }, []);

  return { ...state, reconnect };
};

/** True when the data on screen is fabricated. */
export const useIsSimulated = (): boolean => useConnection().dataSource === 'demo';
