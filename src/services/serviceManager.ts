import { gateflameApi } from './gateflameApi';
import { ApiRequestError } from './apiClient';
import type { ModuleStatus } from '../types/api';
// Re-exported rather than moved-and-updated at every call site: three
// components already import these from here, and the cycle is broken by where
// the data now LIVES, not by who imports it from where.
import { SECURITY_MODULES, slugFor, type ModuleConfig } from './securityModules';

export { SECURITY_MODULES, slugFor };
export type { ModuleConfig };

export interface ToggleResult {
  ok: boolean;
  status: ModuleStatus;
  /** Set when the node acted in name only, or when the result is simulated. */
  advisory?: string;
  /** Set when the node refused — e.g. stopping without kiosk scope. */
  error?: string;
}

export const ApiService = {
  /**
   * Start or stop a security module on the node.
   *
   * This used to be `setTimeout(800); return true`, with the real fetch
   * commented out. It always reported success, so every switch in the product
   * turned green whether or not anything existed to turn on.
   *
   * It now goes through `gateflameApi`, which either reaches real hardware or
   * routes to the simulator and marks the result as simulated. Callers must
   * surface `advisory` rather than treating `ok` as the whole story: a firewall
   * bounce recorded with no packet-filter control is a success *and* a caveat.
   */
  toggleService: async (
    moduleId: string,
    endpoint: string,
    enable: boolean,
  ): Promise<ToggleResult> => {
    const slug = endpoint.split('/').filter(Boolean).pop() ?? moduleId;

    try {
      const result = await gateflameApi.toggleService(moduleId, slug, enable);
      const advisory =
        result.advisory ??
        (result.gap ? `${result.gap}${result.remedy ? ` — ${result.remedy}` : ''}` : undefined);

      return {
        ok: result.status === 'running' || result.status === 'stopped' || result.status === 'degraded',
        status: result.status,
        advisory,
      };
    } catch (error) {
      const message =
        error instanceof ApiRequestError || error instanceof Error
          ? error.message
          : 'Unknown error';

      // A refusal is information, not a glitch. Stopping a module requires
      // kiosk scope by design, so a phone receives a 403 here and the user has
      // to be told why rather than shown a toggle that silently snaps back.
      console.error(`[gateflame] ${enable ? 'start' : 'stop'} ${slug} failed:`, message);
      return { ok: false, status: 'failed', error: message };
    }
  },
};
