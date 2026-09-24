/* ========================================================================================
 * IONIBOT - ACTION HANDLERS
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * The only place in Ionibot that changes anything. Everything else reads.
 *
 * SCOPE DISCIPLINE
 * Starting a module needs only `control` scope - restoring protection is what a remote
 * is for. STOPPING one needs `kiosk` scope, because a real stop tears down enforcement
 * and must survive a stolen but still-paired phone. Ionibot therefore never offers a
 * stop, only a start and a pause. See services.py.
 *
 * ON NOT COMPETING WITH THE WATCHDOG
 * restartResolver is reachable only from IB-207, which is itself reachable only after
 * the customer confirms five minutes have passed. dns-watchdog.sh escalates restart ->
 * recreate -> bypass across five 60s cycles; a second recovery attempt landing in the
 * middle of that makes the outage longer, not shorter.
 * ====================================================================================== */

import type { ActionKind, LocalContext, ScreenId } from './types';

export interface ActionDeps {
  fetch: typeof fetch;
  /**
   * The paired handset's bearer token. Every control route on the node needs it;
   * until 2026-09-21 actions sent none, so pause/resume/restart all 401'd on a
   * live box and Ionibot told the customer to "check it has power".
   */
  authToken?: () => string | null;
  ctx: LocalContext;
  /** Opens a URL outside the app - the OS browser, or system settings. */
  openExternal: (url: string) => Promise<void>;
  /** Deep-links to the OS Wi-Fi settings page. */
  openWifiSettings: () => Promise<void>;
  /** Hands control back to the host app's existing pairing flow. */
  startPairing: () => Promise<void>;
  /** The site the customer typed on IB-301, if any. */
  site?: string;
  /** The category under discussion on IB-303/304, if any. */
  categoryId?: string;
  contactUrl: string;
}

export interface ActionOutcome {
  /** Where to go next. undefined means stay put. */
  go?: ScreenId;
  /** Close the sheet entirely. */
  close?: boolean;
  /** Re-run the probe sweep and route by state. */
  rerun?: boolean;
  /** Something went wrong. Shown inline - never a bare "error". */
  problem?: string;
}

function agent(ctx: LocalContext, path: string): string | null {
  return ctx.nodeIp ? `http://${ctx.nodeIp}:8080${path}` : null;
}

/**
 * One call, three honest outcomes. "Cannot reach it" and "reached it, it said
 * no" need opposite remedies (power vs. a real error message), and a 404 is a
 * third thing again: the box is fine and the feature is not built on it.
 */
export interface CallResult {
  ok: boolean;
  /** HTTP status, or null when nothing answered at all. */
  status: number | null;
  /** The node's own sentence, when it gave one. */
  detail: string | null;
  body: unknown;
}

const UNREACHABLE: CallResult = { ok: false, status: null, detail: null, body: null };

async function call(
  deps: ActionDeps,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
): Promise<CallResult> {
  const url = agent(deps.ctx, path);
  if (!url) return UNREACHABLE;
  const token = deps.authToken?.() ?? null;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await deps.fetch(url, {
      method,
      cache: 'no-store',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    const p = parsed as { detail?: unknown; message?: unknown; error?: unknown } | null;
    const detailRaw = p?.message ?? p?.detail ?? p?.error;
    const detail =
      typeof detailRaw === 'string'
        ? detailRaw
        : detailRaw && typeof detailRaw === 'object' && 'error' in (detailRaw as object)
          ? String((detailRaw as { error: unknown }).error)
          : null;
    return { ok: res.ok, status: res.status, detail, body: parsed };
  } catch {
    return UNREACHABLE;
  }
}

async function post(deps: ActionDeps, path: string, body?: unknown): Promise<CallResult> {
  return call(deps, 'POST', path, body);
}

/** Turn a failed CallResult into the sentence the customer should read. */
function explain(r: CallResult, doing: string): string {
  if (r.status === null) return `I could not reach your box to ${doing}. Check it has power, then try again.`;
  if (r.status === 401 || r.status === 403) {
    return `Your box answered, but this phone is not allowed to ${doing}. Pair it again from Settings.`;
  }
  if (r.status === 404) return `Your box is running, but it cannot ${doing} yet - that part is not installed on it.`;
  return `Your box would not ${doing}: ${r.detail ?? `it answered ${r.status}`}.`;
}

/** Tree args for `pause` are node duration ids ('5m' | '30m' | '2h' | 'until_reboot' | 'indefinite'). */
function pauseDuration(arg: string | number | undefined): string {
  if (typeof arg === 'string') return arg;
  if (arg === 5) return '5m';
  if (arg === 30) return '30m';
  if (arg === 60 || arg === 120) return '2h';
  return '5m';
}

export async function runAction(
  kind: ActionKind,
  arg: string | number | undefined,
  go: ScreenId | undefined,
  deps: ActionDeps,
): Promise<ActionOutcome> {
  switch (kind) {
    case 'goto':
      return { go };

    case 'back':
      return {}; // handled by the sheet's own history stack

    case 'close':
      return { close: true };

    case 'rerunDiagnosis':
      return { rerun: true };

    case 'openWifiSettings':
      await deps.openWifiSettings();
      return {};

    case 'openRouterAdmin': {
      if (!deps.ctx.gateway) {
        return { problem: 'I do not know your router address yet. You can find it printed on the router.' };
      }
      await deps.openExternal(`http://${deps.ctx.gateway}/`);
      return {};
    }

    case 'startPairing':
      await deps.startPairing();
      return { go };

    /**
     * Start the DNS module. `control` scope, which any paired handset has.
     * Deliberately a START and never a STOP.
     */
    case 'restartResolver': {
      const r = await post(deps, '/api/v1/services/dns/start');
      return r.ok ? { go } : { problem: explain(r, 'restart its filter') };
    }

    case 'pause': {
      // The route takes PauseBody {duration, reason}. It used to be sent
      // {minutes, indefinite} - a 422 on every tap, reported as a power fault.
      const r = await post(deps, '/api/v1/filtering/pause', {
        duration: pauseDuration(arg),
        reason: 'Paused from Ionibot',
      });
      return r.ok ? { go } : { problem: explain(r, 'pause protection') };
    }

    case 'resume': {
      const r = await post(deps, '/api/v1/filtering/resume');
      return r.ok ? { go } : { problem: explain(r, 'turn protection back on') };
    }

    case 'allowSite': {
      if (!deps.site) return { problem: 'I did not catch which website you meant.' };
      // There is no per-site allow route on the node today. Ask anyway so that
      // the day one exists this starts working, and until then say what is true:
      // the box is fine, the feature is not on it. Never "check it has power".
      const r = await post(deps, '/api/v1/filtering/allow', { domain: deps.site });
      if (r.ok) return { go };
      if (r.status === 404) {
        return {
          problem: `Your box cannot allow a single website yet - that is not built. To reach ${deps.site} now, pause protection for five minutes.`,
        };
      }
      return { problem: explain(r, 'allow that website') };
    }

    case 'disableCategory': {
      if (!deps.categoryId) return { problem: 'I did not catch which category you meant.' };
      // The route takes {categories: string[]} - the FULL list to keep on. So
      // read what is on, drop this one, write the rest back. The old code sent
      // {[id]: false}, which the node rejected with 422 every time.
      const current = await call(deps, 'GET', '/api/v1/filtering');
      if (!current.ok) return { problem: explain(current, 'read its category settings') };
      const cats = (current.body as { categories?: Array<{ id: string; enabled: boolean }> } | null)?.categories;
      if (!Array.isArray(cats)) return { problem: 'Your box answered, but not with a category list I recognise.' };
      const keep = cats.filter((c) => c.enabled && c.id !== deps.categoryId).map((c) => c.id);
      const r = await call(deps, 'PUT', '/api/v1/filtering/categories', { categories: keep });
      return r.ok ? { go } : { problem: explain(r, 'change that category') };
    }

    /**
     * Reverse the router handshake, THEN unpair.
     *
     * Order is not negotiable. router_handshake.py records every change so it can be
     * put back, but only a LIVING box can execute the reversal. If the reversal fails
     * we must refuse to unpair and say so - silently unpairing would leave the router
     * pointed at a box that is about to be unplugged, which is a household outage
     * with no path back. This is test T15 and it has never been exercised.
     */
    case 'revertRouterAndRemove': {
      const reverted = await post(deps, '/api/v1/pair/router/revert');
      if (!reverted.ok) {
        if (reverted.status === 404) {
          // The route is not built (router_adapters.py: credentialed login is
          // deliberately unbuilt). Refusing to unpair is still right - but the
          // reason must be the true one, not "check its power light".
          const gw = deps.ctx.gateway ? ` at http://${deps.ctx.gateway}/` : '';
          return {
            problem: `Your box cannot change your router by itself yet. Set the router's DNS back to automatic in its admin page${gw}, then you can remove the box from Settings. I have not removed anything.`,
          };
        }
        return { problem: `${explain(reverted, 'put your router back')} I have not removed anything.` };
      }
      const cleared = await post(deps, '/api/v1/pair/devices/revoke-all');
      if (!cleared.ok) {
        return {
          problem:
            'Your router is back to normal and it is safe to unplug the box. I could not finish clearing the paired phones - you can do that later from the app.',
        };
      }
      return { go };
    }

    case 'contactSupport':
      await deps.openExternal(deps.contactUrl);
      return {};

    default:
      return {};
  }
}
