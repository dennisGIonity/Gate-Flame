/**
 * Gate^Flame — the KIOSK's side of the Ionibot integration.
 *
 * Ionibot's README used to open with "MOBILE APP ONLY. THE KIOSK IS NOT
 * TOUCHED." That was true of the moment it was written, not a property of the
 * component: it imports its own types and nothing else, which is exactly what
 * makes mounting it here a context object rather than a rewrite.
 *
 * WHY THE KIOSK IS ACTUALLY THE BETTER HOME FOR IT
 * Ionibot's probes talk to the node over HTTP. On a phone that means crossing
 * the LAN and depending on the very Wi-Fi the customer is asking about - the
 * help sheet is least reachable exactly when it is most needed. The kiosk runs
 * ON the box, so its probes are loopback: they still work when the household's
 * network is the thing that is broken.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM THE PHONE
 *   * `paired` is always true. The console is not a paired device; it IS the
 *     box. Reporting it as unpaired would send the customer down IB screens
 *     that ask them to pair the very thing they are standing in front of.
 *   * `startPairing` is not wired to "forget the node". On the phone that
 *     means "drop this pairing and find the box again". Here it would mean the
 *     console forgetting itself, which is meaningless at best.
 */

import { apiRoot, consoleAuthority } from './kioskClient';
import type { LocalContext } from '../../ionibot';

const GATEWAY_KEY = 'gateflame-kiosk-gateway';

/**
 * The host:port Ionibot should build its probe URLs from.
 *
 * Probe A4 constructs `http://${nodeIp}:8080/...` itself, so this must be a
 * BARE HOST - handing it a full URL yields `http://http://host:8080:8080/...`.
 * Returning null is safe: probe A4 reports `unknown` and resolveState handles
 * it, whereas throwing would take the whole help sheet down at the moment
 * somebody needs it.
 */
export function kioskNodeHost(): string | null {
  if (typeof window === 'undefined') return null;
  const h = window.location.hostname;
  return h || null;
}

const recallGateway = (): string | null => {
  try {
    return window.localStorage.getItem(GATEWAY_KEY);
  } catch {
    return null;
  }
};

export const rememberKioskGateway = (value: string): void => {
  try {
    window.localStorage.setItem(GATEWAY_KEY, value);
  } catch {
    /* storage blocked - we simply ask the box again next launch */
  }
};

/**
 * Ask the box for the gateway once and cache it.
 *
 * The screens that need `{{gateway}}` are precisely the ones a customer
 * reaches when their network is not working, so the value has to already be in
 * hand by then. A WebView cannot read the default gateway without a native
 * plugin, and Ionibot's standing rule is that it adds no required dependency -
 * so the box, which already knows, is asked instead.
 */
export async function learnKioskGateway(): Promise<string | null> {
  const cached = recallGateway();
  if (cached) return cached;
  try {
    const r = await fetch(`${apiRoot()}/system/netcheck`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    const body = (await r.json()) as { gateway?: string | null };
    if (body.gateway) {
      rememberKioskGateway(body.gateway);
      return body.gateway;
    }
  } catch {
    /* offline or route absent - the guided screens degrade, they do not break */
  }
  return null;
}

export function buildKioskIonibotContext(gateway: string | null): LocalContext {
  return {
    nodeIp: kioskNodeHost(),
    gateway,
    routerChanged: false,
    routerModel: null,
    // Always true, and not a shortcut: see the header. The console is the box.
    paired: true,
  };
}

/** Whether this console may run Ionibot's repair actions, or only read.
 *
 * Same loopback rule the rest of the console uses. A viewer over the LAN gets
 * the instructions - which are the useful part - but not the buttons that
 * change the household's protection. */
export function ionibotMayAct(): boolean {
  return consoleAuthority() === 'console';
}
