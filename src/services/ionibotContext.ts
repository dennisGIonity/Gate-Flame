/**
 * Gate^Flame — the host app's side of the Ionibot integration.
 *
 * Ionibot is written to be dropped into another app unchanged: it imports its
 * own types and nothing else. Everything that ties it to THIS app lives here,
 * so `src/ionibot/` stays portable and this file stays the only thing to read
 * when the integration breaks.
 *
 * It supplies the three things `src/ionibot/README.md` lists as host
 * obligations: the cached node address, the cached gateway, and the paired
 * token for the read-scoped netcheck route.
 *
 * WHY THE GATEWAY IS CACHED AND NOT PROBED
 * A WebView cannot read the default gateway without a native plugin, and
 * Ionibot's standing rule is that it adds no required dependency. The box
 * already knows the gateway — `gateflame-netcheck.sh` reports it — so we ask
 * once, keep it, and every router-instruction screen renders offline from then
 * on. That matters: the screens that need `{{gateway}}` are exactly the screens
 * a customer reaches when their network is not working.
 */

import { config } from '../config/env';
import { apiRequest, getToken } from './apiClient';
import { getConnection } from './gateflameApi';
import type { LocalContext } from '../ionibot';

const GATEWAY_KEY = 'gateflame-gateway';

/** Shape of the netcheck payload, narrowed to the one field wanted here. */
interface NetcheckGateway {
  gateway?: string | null;
}

const recallGateway = (): string | null => {
  try {
    return window.localStorage.getItem(GATEWAY_KEY);
  } catch {
    return null;
  }
};

const rememberGateway = (value: string): void => {
  try {
    window.localStorage.setItem(GATEWAY_KEY, value);
  } catch {
    /* storage blocked — we simply ask the box again next launch */
  }
};

/**
 * Strip scheme and port from the node base URL.
 *
 * Ionibot's probe A4 builds `http://${nodeIp}:8080/...` itself, so handing it a
 * full URL would produce `http://http://host:8080:8080/...`. Deliberately
 * tolerant of a missing/odd value: returning null makes probe A4 report
 * `unknown`, which resolveState handles, whereas throwing here would take the
 * whole help sheet down.
 */
export const hostFromBaseUrl = (baseUrl: string | null): string | null => {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).hostname || null;
  } catch {
    return null;
  }
};

/**
 * Ask the box for the gateway, once, and remember it.
 *
 * Silent on failure by design. This runs opportunistically in the background;
 * a customer who never opens Ionibot should never see an error from it, and a
 * customer who does open it gets a screen that renders without the address
 * rather than no screen at all.
 */
export async function learnGateway(): Promise<string | null> {
  const cached = recallGateway();
  if (cached) return cached;

  const { nodeBaseUrl } = getConnection();
  if (!nodeBaseUrl || !getToken()) return null;

  try {
    const nc = await apiRequest<NetcheckGateway>(nodeBaseUrl, '/posture/netcheck', {
      timeoutMs: config.apiTimeoutMs,
    });
    if (nc?.gateway) {
      rememberGateway(nc.gateway);
      return nc.gateway;
    }
  } catch {
    /* box unreachable or unpaired — try again next launch */
  }
  return null;
}

/** Forget the cached gateway. Called on unpair, so a new install re-learns it. */
export const forgetGateway = (): void => {
  try {
    window.localStorage.removeItem(GATEWAY_KEY);
  } catch {
    /* ignore */
  }
};

/**
 * Build the context Ionibot renders from.
 *
 * `routerChanged` is HARDCODED FALSE, and that is not laziness. It is supposed
 * to be true only once the router handshake has verifiably taken, and the agent
 * exposes no endpoint reporting that today. Guessing `true` would be exactly the
 * fabricated-state problem `DataSourceBanner` exists to prevent.
 *
 * Post-ADR-001 the flag drives nothing dangerous: it used to gate IB-605's
 * "do NOT unplug before I revert your router" warning, and that warning is gone
 * because the router falls back on its own. When a `/pair/router/status`
 * endpoint exists, read it here.
 */
export function buildIonibotContext(gateway: string | null): LocalContext {
  const { nodeBaseUrl } = getConnection();
  return {
    nodeIp: hostFromBaseUrl(nodeBaseUrl),
    gateway,
    routerChanged: false,
    routerModel: null,
    paired: getToken() !== null,
  };
}
