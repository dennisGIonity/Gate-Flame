/* ========================================================================================
 * IONIBOT - STATE RESOLVER
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * A pure function from a ProbeReport to one of seven states. No I/O, no clock, no
 * randomness - so every state is testable by constructing a report, and the whole
 * diagnostic engine can be exercised on a laptop with no Pi and no network.
 *
 * ST  A1    A2     A3    A4    LISTENER  MEANING
 * --  ----  -----  ----  ----  --------  ---------------------------------------------
 * S0  FAIL  -      -     -     -         Handset on mobile data, not the home Wi-Fi
 * S1  PASS  FAIL   -     -     -         No internet at all. Router or ISP. NOT US.
 * S2  PASS  PASS   FAIL  FAIL  -         Box unreachable AND names not resolving.
 * S3  PASS  PASS   FAIL  PASS  FAIL      Box alive, resolver down. Watchdog's job.
 * S4  PASS  PASS   FAIL  PASS  PASS      Box resolves; this phone isn't using it.
 * S5  PASS  PASS   PASS  FAIL  -         All fine, but we cannot see the box.
 * S6  PASS  PASS   PASS  PASS  PASS      Healthy.
 *
 * THE LOAD-BEARING COMPARISON is A2 against A3. A2 reaches an IP literal, so it
 * needs no name lookup; A3 reaches a hostname, so it does. A2 passing while A3
 * fails means name resolution is broken, and name resolution is the one thing this
 * product took responsibility for. That is how Ionibot can say "this is ours" or
 * "this is not ours" and be right.
 *
 * ON 'unknown'
 * A probe that could not run must never be counted as a pass. Where a state hinges
 * on a probe we do not have, we resolve to the more conservative neighbouring state
 * and let the copy say we could not check. posture.py draws the same line between a
 * finding and a gap, for the same reason.
 * ====================================================================================== */

import type { ProbeReport, StateId } from './types';

export function resolveState(r: ProbeReport): StateId {
  // S0 - not on Wi-Fi. 'unknown' does NOT land here: if the Network plugin could
  // not answer, telling the customer they are on mobile data would be a guess, and
  // a wrong one sends them to a screen that cannot help.
  if (r.wifi === 'fail') return 'S0';

  // S1 - no internet path at all. Nothing downstream is diagnosable, and the box
  // cannot be the cause: it only decides which names are allowed, it does not
  // carry the line.
  if (r.rawIp === 'fail') return 'S1';

  // Name resolution works. The remaining question is only whether we can see the
  // box well enough to report on it.
  if (r.dns === 'pass') {
    return r.node === 'pass' ? 'S6' : 'S5';
  }

  // From here: there is an internet path, but names do not resolve. This is ours.
  if (r.node !== 'pass') {
    // Cannot reach the agent either. The box is off, unplugged, or not on this LAN.
    //
    // ADR-001 CHANGED WHAT THIS MEANS, without changing the logic. When we were the
    // DHCP-handed resolver, "box off" landed here every time and this was the Class A
    // outage. As an upstream, a box going off normally leaves lookups working — the
    // router just answers them itself — so the ordinary "box off" case now resolves
    // to S5, not here. Reaching S2 means the box is unreachable AND the router did
    // not fall back, which is the rarer and more serious pair. IB-204 and IB-209 were
    // rewritten together to match; if you change one, read the other.
    return 'S2';
  }

  // The agent answers, so the box has power and the network. The question is
  // whether the household-facing resolver is alive.
  if (r.listener === 'pass') {
    // The box resolves for the LAN, yet this handset's lookups fail - so this
    // handset is asking something else. Overwhelmingly this is the router
    // advertising itself as IPv6 DNS server; phones prefer IPv6 and take it.
    return 'S4';
  }

  // listener 'fail' or 'unknown'. Both resolve to S3, whose copy tells the customer
  // the box is already restarting the resolver by itself - true either way, and the
  // conservative answer when we could not confirm.
  return 'S3';
}

/* -------------------------------------------------------------- netcheck shortcuts */

/** Is the box currently serving DNS unfiltered? Drives the persistent warning banner. */
export function isInBypass(r: ProbeReport): boolean {
  return r.netcheck?.results.some((x) => x.check === 'bypass' && x.status === 'FAIL') ?? false;
}

/** Is the router actually sending the household to us? A FAIL means nothing is filtered. */
export function routerForwarding(r: ProbeReport): boolean | null {
  const hit = r.netcheck?.results.find((x) => x.check === 'router');
  if (!hit) return null;
  return hit.status === 'PASS';
}

/** Router advertising IPv6 it cannot route - the phone-killer. */
export function ipv6Broken(r: ProbeReport): boolean {
  return r.netcheck?.results.some((x) => x.check === 'ipv6' && x.status === 'FAIL') ?? false;
}

/**
 * Conditions to present, in netcheck's own fix order.
 *
 * The order is not cosmetic and must not be sorted by severity or alphabetically.
 * Each of these can MASK the next: nothing is filtered until the router forwards,
 * phones keep dropping until IPv6 is fixed, dual-homing makes everything
 * intermittent, and rate limiting causes whole-house blackouts only once the
 * router has started forwarding. Presenting them out of order sends the customer
 * to fix something whose symptom is being produced by something else.
 */
export const FIX_ORDER = ['router', 'ipv6', 'dualhome', 'ratelimit'] as const;

export function orderedFailures(r: ProbeReport): { check: string; message: string }[] {
  const results = r.netcheck?.results ?? [];
  const ranked = (c: string) => {
    const i = (FIX_ORDER as readonly string[]).indexOf(c);
    return i === -1 ? FIX_ORDER.length : i;
  };
  return results
    .filter((x) => x.status === 'FAIL')
    .sort((a, b) => ranked(a.check) - ranked(b.check))
    .map(({ check, message }) => ({ check, message }));
}
