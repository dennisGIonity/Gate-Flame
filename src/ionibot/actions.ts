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

async function post(
  deps: ActionDeps,
  path: string,
  body?: unknown,
): Promise<boolean> {
  const url = agent(deps.ctx, path);
  if (!url) return false;
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
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
      const ok = await post(deps, '/api/v1/services/dns/start');
      return ok
        ? { go }
        : { problem: 'I could not reach your box to restart it. Check it has power, then try again.' };
    }

    case 'pause': {
      const indefinite = arg === 'indefinite';
      const ok = await post(deps, '/api/v1/filtering/pause', {
        minutes: indefinite ? null : Number(arg),
        indefinite,
      });
      return ok
        ? { go }
        : { problem: 'I could not reach your box to pause protection. Check it has power, then try again.' };
    }

    case 'resume': {
      const ok = await post(deps, '/api/v1/filtering/resume');
      return ok
        ? { go }
        : { problem: 'I could not reach your box to turn protection back on. Check it has power, then try again.' };
    }

    case 'allowSite': {
      if (!deps.site) return { problem: 'I did not catch which website you meant.' };
      const ok = await post(deps, '/api/v1/filtering/allow', { domain: deps.site });
      return ok
        ? { go }
        : { problem: 'I could not reach your box to allow that website. Check it has power, then try again.' };
    }

    case 'disableCategory': {
      if (!deps.categoryId) return { problem: 'I did not catch which category you meant.' };
      const url = agent(deps.ctx, '/api/v1/filtering/categories');
      if (!url) return { problem: 'I cannot reach your box right now.' };
      try {
        const res = await deps.fetch(url, {
          method: 'PUT',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [deps.categoryId]: false }),
        });
        return res.ok
          ? { go }
          : { problem: 'Your box did not accept that change. Try again in a moment.' };
      } catch {
        return { problem: 'I could not reach your box. Check it has power, then try again.' };
      }
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
      if (!reverted) {
        return {
          problem:
            'I could not put your router back yet, so I have not removed anything. Your box must be switched on for this. Check its power light and try again.',
        };
      }
      const cleared = await post(deps, '/api/v1/pair/devices/revoke-all');
      if (!cleared) {
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
