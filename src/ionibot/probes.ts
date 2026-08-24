/* ========================================================================================
 * IONIBOT - PROBE LAYER
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * FIVE PROBES. ALL LOCAL. ALL VIA fetch(). NO NATIVE PLUGINS. NO NEW PERMISSIONS.
 *
 * WHY IT IS SHAPED LIKE THIS
 *
 * The specification originally called for raw TCP and UDP probes and an SSID match.
 * None of the three survived contact with the platform:
 *
 *   - a Capacitor WebView cannot open a raw socket, so "is the gateway reachable"
 *     and "does the box answer on port 53" cannot be asked directly;
 *   - reading the Wi-Fi SSID on Android 10+ requires ACCESS_FINE_LOCATION, and a
 *     security product must not ask for location permission to render a help screen.
 *
 * So the probes were rebuilt out of what a WebView actually has. The single insight
 * that makes this work is that fetch() to an IP LITERAL performs no name lookup,
 * while fetch() to a hostname requires one. Comparing those two answers is the
 * entire diagnostic:
 *
 *     rawIp PASS + dns FAIL  ->  name lookup is broken  ->  IT IS OURS
 *     rawIp FAIL             ->  the line or the router ->  IT IS NOT OURS
 *
 * Everything else Ionibot needs, the box already computes in gateflame-netcheck.sh.
 * We render that rather than re-deriving it, so the app and the box can never
 * disagree about whether the household is protected.
 *
 * NOTHING IN THIS FILE TRANSMITS, LOGS OR PERSISTS A RESULT. Probe output lives in
 * React state for the duration of the sheet being open and is then discarded.
 * ====================================================================================== */

import type { LocalContext, NetcheckPayload, ProbeReport, ProbeResult } from './types';

/* ------------------------------------------------------------------ configuration */

/**
 * A2 targets. IP literals only - a hostname here would silently defeat the probe.
 * Both are anycast addresses that answer TLS on their own certificate, so no name
 * lookup is required to reach them.
 */
const RAW_IP_URLS = ['https://1.1.1.1/cdn-cgi/trace', 'https://8.8.8.8/'] as const;

/** A3 targets. Hostnames only. Resolution MUST be required for this to mean anything. */
const DNS_URLS = ['https://dns.google/generate_204', 'https://one.one.one.one/'] as const;

const TIMEOUT_RAW_MS = 3500;
const TIMEOUT_DNS_MS = 5000;
const TIMEOUT_NODE_MS = 3000;
const TIMEOUT_NETCHECK_MS = 6000;

/** Hard ceiling on the whole sweep. Past this we route on what we have. Never hang. */
export const SWEEP_BUDGET_MS = 8000;

/* ------------------------------------------------------------------------ plumbing */

/**
 * Injectable dependencies. Everything that touches the outside world goes through
 * here, so all seven states can be driven in tests without a Pi, a router, or a
 * network - the same seam discipline as firewall.py and wan.py.
 */
export interface ProbeDeps {
  fetch: typeof fetch;
  /**
   * Reports whether the handset is on Wi-Fi or mobile data.
   *
   * Return connectionType 'unknown' when it cannot be determined. Ionibot treats
   * that as unknown and NOT as a failure - see probeWifi.
   */
  networkStatus: () => Promise<{ connected: boolean; connectionType: string }>;
  now: () => number;
  /**
   * The paired device token, or null when this handset is not paired.
   *
   * `/api/v1/posture/netcheck` is `read`-scoped on the agent, deliberately: the
   * payload names the gateway, the box's address and whether filtering is
   * currently bypassed, and "already on the LAN" includes the guest network.
   *
   * Injected rather than read here so this folder keeps importing nothing but
   * its own types. Returning null is a first-class answer — probe A5 then gets a
   * 401, yields `unknown`, and resolveState refuses to turn that into the
   * "your phone is bypassing the box" screen.
   */
  authToken: () => string | null;
}

export const defaultDeps: ProbeDeps = {
  // Explicitly parameterised rather than spread: a spread argument needs a tuple
  // type under this repo's tsconfig, and an unbound globalThis.fetch throws
  // "Illegal invocation" in some WebViews.
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init),

  /**
   * NO NETWORK PLUGIN IS WIRED UP BY DEFAULT, AND IONIBOT DOES NOT ADD ONE.
   *
   * This module deliberately contains no import of @capacitor/network. That plugin
   * is not a dependency of this app, and an earlier draft that imported it lazily
   * broke the build outright: Vite resolves a dynamic import with a literal
   * specifier at transform time, so /* @vite-ignore *\/ does not save it. Wiring an
   * optional native plugin through a try/catch was the wrong shape anyway - it hid
   * a deployment fact inside a swallowed exception.
   *
   * So the optionality lives at the integration boundary instead, where it is
   * visible. Ionibot reports 'unknown' and resolveState is written so that
   * 'unknown' NEVER resolves to S0. A handset on mobile data lands on S5 - "your
   * internet is fine, I just cannot see your box" - which is true and useful, just
   * less specific than S0's wording.
   *
   * TO UNLOCK THE BETTER S0 COPY, install the plugin and inject it:
   *
   *     npm i @capacitor/network && npx cap sync
   *
   *     import { Network } from '@capacitor/network';
   *     <Ionibot probeDeps={{
   *       ...defaultDeps,
   *       networkStatus: async () => {
   *         const s = await Network.getStatus();
   *         return { connected: s.connected, connectionType: s.connectionType };
   *       },
   *     }} ... />
   */
  networkStatus: async () => ({ connected: true, connectionType: 'unknown' }),

  now: () => Date.now(),

  // Unpaired by default. Same reasoning as networkStatus above: the optionality
  // lives at the integration boundary where it is visible, not inside a
  // swallowed exception. The host app injects the real reader.
  authToken: () => null,
};

/**
 * A reachability test that only cares whether the request got anywhere.
 *
 * mode:'no-cors' is deliberate. We are not reading these responses - we only need
 * to know whether the network layer completed. An opaque response is a PASS; a
 * thrown TypeError is a FAIL. This also means no CORS headers are required on any
 * third-party endpoint, so the probe cannot break because someone else changed a
 * header.
 *
 * cache:'no-store' is not optional. A cached 200 from an earlier healthy moment
 * would report a dead network as alive, which is the one lie this module must
 * never tell.
 */
async function reachable(
  deps: ProbeDeps,
  url: string,
  timeoutMs: number,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await deps.fetch(url, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** First target to answer wins. A single flaky endpoint must not fake an outage. */
async function anyReachable(
  deps: ProbeDeps,
  urls: readonly string[],
  timeoutMs: number,
): Promise<ProbeResult> {
  for (const url of urls) {
    if (await reachable(deps, url, timeoutMs)) return 'pass';
  }
  return 'fail';
}

/* --------------------------------------------------------------------- the probes */

/**
 * A1 - is this handset on Wi-Fi rather than mobile data?
 *
 * 'unknown' is a first-class answer here, not an error path. Telling a customer
 * "this phone is on mobile data" when we could not determine that sends them to a
 * screen that cannot help them, over a fact we guessed. Both the unavailable case
 * and the indeterminate case therefore return 'unknown', and resolveState refuses
 * to turn 'unknown' into S0.
 */
export async function probeWifi(deps: ProbeDeps): Promise<ProbeResult> {
  try {
    const s = await deps.networkStatus();
    if (!s.connectionType || s.connectionType === 'unknown') return 'unknown';
    return s.connected && s.connectionType === 'wifi' ? 'pass' : 'fail';
  } catch {
    return 'unknown';
  }
}

/** A2 - internet path, with name resolution taken out of the question. */
export function probeRawIp(deps: ProbeDeps): Promise<ProbeResult> {
  return anyReachable(deps, RAW_IP_URLS, TIMEOUT_RAW_MS);
}

/** A3 - name resolution through whatever resolver this handset was handed. */
export function probeDns(deps: ProbeDeps): Promise<ProbeResult> {
  return anyReachable(deps, DNS_URLS, TIMEOUT_DNS_MS);
}

/**
 * A4 - is the agent alive and reachable from this handset?
 *
 * Uses the CACHED node IP, never gateflame.local. avahi publishes every address the
 * box holds, so under dual-homing the mDNS name can resolve to an address that
 * serves the API while having no resolver behind it - which would make a broken
 * install look healthy. The cached literal is unambiguous.
 *
 * Requires cleartext HTTP to a LAN address. Android needs the network-security
 * config entry and iOS an ATS exception; commit cfccc48 fixed exactly this.
 */
export async function probeNode(
  deps: ProbeDeps,
  ctx: LocalContext,
): Promise<ProbeResult> {
  if (!ctx.nodeIp) return 'unknown';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_NODE_MS);
  try {
    const res = await deps.fetch(
      `http://${ctx.nodeIp}:8080/api/v1/system/status`,
      { method: 'GET', cache: 'no-store', signal: controller.signal },
    );
    return res.ok ? 'pass' : 'fail';
  } catch {
    return 'fail';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A5 - the box's own netcheck. Only attempted when A4 passed.
 *
 * We render the box's answer rather than computing our own. If the app and the box
 * ever disagreed about whether the household is protected, the customer would have
 * no way to tell which was lying.
 */
export async function probeNetcheck(
  deps: ProbeDeps,
  ctx: LocalContext,
): Promise<NetcheckPayload | null> {
  if (!ctx.nodeIp) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_NETCHECK_MS);
  try {
    // The route is `read`-scoped. An unpaired handset sends no header, takes a
    // 401, and lands on `unknown` — which is the truth, and is why this returns
    // null rather than throwing.
    const token = deps.authToken();
    const res = await deps.fetch(
      `http://${ctx.nodeIp}:8080/api/v1/posture/netcheck`,
      {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as NetcheckPayload;
    return Array.isArray(json?.results) ? json : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Did the household-facing listener answer?
 *
 * netcheck's `lanlistener` check is the authoritative answer to "can anything on
 * this LAN resolve through the box". A missing check is `unknown`, NOT a pass -
 * a clean bill of health from a blind check is worse than no check at all, because
 * the customer stops looking.
 */
export function listenerFromNetcheck(nc: NetcheckPayload | null): ProbeResult {
  if (!nc) return 'unknown';
  const hit = nc.results.find((r) => r.check === 'lanlistener');
  if (!hit) return 'unknown';
  return hit.status === 'FAIL' ? 'fail' : 'pass';
}

/* ----------------------------------------------------------------------- the sweep */

/**
 * Run the full sweep and return a report.
 *
 * Short-circuits deliberately: if there is no internet path at all there is no
 * point asking anything else, and every skipped probe is a second the customer
 * spends staring at a progress bar.
 *
 * A2 and A4 run concurrently because they are independent and both are wanted in
 * almost every branch.
 */
export async function runProbes(
  ctx: LocalContext,
  deps: ProbeDeps = defaultDeps,
): Promise<ProbeReport> {
  const started = deps.now();
  const blank: ProbeReport = {
    wifi: 'unknown',
    rawIp: 'unknown',
    dns: 'unknown',
    node: 'unknown',
    listener: 'unknown',
    netcheck: null,
    elapsedMs: 0,
  };

  const wifi = await probeWifi(deps);
  if (wifi === 'fail') {
    return { ...blank, wifi, elapsedMs: deps.now() - started };
  }

  const [rawIp, node] = await Promise.all([probeRawIp(deps), probeNode(deps, ctx)]);

  if (rawIp === 'fail') {
    // No path to the internet. Name resolution is moot and the box is not the
    // cause, so stop here rather than spending five seconds proving it.
    return { ...blank, wifi, rawIp, node, elapsedMs: deps.now() - started };
  }

  const dns = await probeDns(deps);

  let netcheck: NetcheckPayload | null = null;
  if (node === 'pass') {
    netcheck = await probeNetcheck(deps, ctx);
  }

  return {
    wifi,
    rawIp,
    dns,
    node,
    listener: listenerFromNetcheck(netcheck),
    netcheck,
    elapsedMs: deps.now() - started,
  };
}
