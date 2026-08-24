/* ========================================================================================
 * IONIBOT - TESTS
 * Author: Johan Wilhelm van Antwerp | Ionity (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * Runs with vitest. No Pi, no router, no network, no root - the probe layer is injected,
 * and the resolver and tree are pure data. Every one of the seven states is driven here.
 *
 * These tests exist to pin the promises in DOC-2026-08-004 section 8. Each block names
 * the acceptance criterion it enforces.
 * ====================================================================================== */

import { describe, expect, it } from 'vitest';
import { defaultDeps, listenerFromNetcheck, probeWifi, runProbes, type ProbeDeps } from './probes';
import { FIX_ORDER, orderedFailures, resolveState } from './resolveState';
import { TREE } from './tree';
import { fill } from './render';
import type { LocalContext, NetcheckPayload, ProbeReport } from './types';

/* -------------------------------------------------------------------------- fixtures */

const CTX: LocalContext = {
  nodeIp: '192.168.0.10',
  gateway: '192.168.0.1',
  routerChanged: true,
  routerModel: 'TestRouter 1',
  paired: true,
};

const blank: ProbeReport = {
  wifi: 'pass', rawIp: 'pass', dns: 'pass', node: 'pass',
  listener: 'pass', netcheck: null, elapsedMs: 0,
};

const r = (o: Partial<ProbeReport>): ProbeReport => ({ ...blank, ...o });

/** A fetch stub driven by URL substring -> ok / throw. */
function stubFetch(rules: { match: string; ok?: boolean; throws?: boolean; json?: unknown }[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const hit = rules.find((x) => url.includes(x.match));
    if (!hit || hit.throws) throw new TypeError('network');
    return {
      ok: hit.ok ?? true,
      json: async () => hit.json ?? {},
    } as Response;
  }) as unknown as typeof fetch;
}

function deps(fetchImpl: typeof fetch, connectionType = 'wifi'): ProbeDeps {
  return {
    fetch: fetchImpl,
    networkStatus: async () => ({ connected: true, connectionType }),
    now: () => 0,
    authToken: () => 'test-token',
  };
}

const NC = (results: NetcheckPayload['results']): NetcheckPayload => ({
  fails: results.filter((x) => x.status === 'FAIL').length,
  warns: results.filter((x) => x.status === 'WARN').length,
  lan_ip: '192.168.0.10',
  gateway: '192.168.0.1',
  results,
});

/* ============================================================== AC1 - all seven states */

describe('AC1 - every state resolves, and resolves to exactly one screen', () => {
  const cases: [string, ProbeReport, string][] = [
    ['S0 phone on mobile data',        r({ wifi: 'fail' }),                                              'S0'],
    ['S1 no internet at all',          r({ rawIp: 'fail' }),                                             'S1'],
    ['S2 box off',                     r({ dns: 'fail', node: 'fail' }),                                 'S2'],
    ['S3 resolver down on a live box', r({ dns: 'fail', node: 'pass', listener: 'fail' }),               'S3'],
    ['S4 phone bypassing the box',     r({ dns: 'fail', node: 'pass', listener: 'pass' }),               'S4'],
    ['S5 healthy but box unseen',      r({ node: 'fail' }),                                              'S5'],
    ['S6 healthy',                     blank,                                                            'S6'],
  ];

  it.each(cases)('%s', (_name, report, expected) => {
    expect(resolveState(report)).toBe(expected);
  });

  it('maps every state to a screen that exists', () => {
    for (const [state, id] of Object.entries(TREE.stateScreens)) {
      expect(TREE.screens[id], `${state} -> ${id}`).toBeDefined();
    }
  });
});

describe('AC1 - the states that were actually observed in the field', () => {
  /**
   * S2 is the outage that started this work: the box was switched off, the router
   * kept pointing at it, and nothing recovered. It MUST NOT be reported as an ISP
   * fault, because that sends the customer to restart a router that is working.
   */
  it('S2 is distinguished from an ISP outage by the raw-IP probe', () => {
    expect(resolveState(r({ rawIp: 'pass', dns: 'fail', node: 'fail' }))).toBe('S2');
    expect(resolveState(r({ rawIp: 'fail', dns: 'fail', node: 'fail' }))).toBe('S1');
  });

  /**
   * S4 is the 2026-08-18 fault: the box answers the LAN, but the handset asks the
   * router because the router advertises itself as IPv6 DNS server. Took days to
   * find by hand. The whole point of the listener probe is that this is now a
   * three-second answer.
   */
  it('S4 is detected by the box answering while this handset cannot resolve', () => {
    expect(resolveState(r({ dns: 'fail', node: 'pass', listener: 'pass' }))).toBe('S4');
  });
});

/* ============================================ honesty: unknown is never a pass */

describe('a check that could not run is never treated as a pass', () => {
  it('an unreadable listener resolves to S3, not S4', () => {
    // S4 tells the customer their phone is bypassing the box. Claiming that on the
    // strength of a check we could not perform would send them to change a router
    // setting for no reason.
    expect(resolveState(r({ dns: 'fail', node: 'pass', listener: 'unknown' }))).toBe('S3');
  });

  it('an unavailable network plugin does not report "you are on mobile data"', () => {
    expect(resolveState(r({ wifi: 'unknown' }))).not.toBe('S0');
  });

  it('a missing netcheck yields unknown, not pass', () => {
    expect(listenerFromNetcheck(null)).toBe('unknown');
    expect(listenerFromNetcheck(NC([]))).toBe('unknown');
  });

  it('a present lanlistener check is honoured exactly', () => {
    expect(listenerFromNetcheck(NC([{ status: 'FAIL', check: 'lanlistener', message: '' }]))).toBe('fail');
    expect(listenerFromNetcheck(NC([{ status: 'PASS', check: 'lanlistener', message: '' }]))).toBe('pass');
  });
});

/* ================================== zero required dependencies (AC5) */

describe('AC5 - Ionibot adds no required dependency', () => {
  /**
   * @capacitor/network is NOT installed in this app. An earlier draft imported it
   * lazily and broke the build: Vite resolves a dynamic import with a literal
   * specifier at transform time, so @vite-ignore does not save it. The plugin is
   * now injected by the host app or not at all.
   */
  it('the default network probe reports unknown rather than guessing', async () => {
    expect(await probeWifi(defaultDeps)).toBe('unknown');
  });

  it('an unknown Wi-Fi state never sends the customer to the mobile-data screen', async () => {
    const out = await runProbes(CTX, {
      ...defaultDeps,
      fetch: stubFetch([{ match: '1.1.1.1', ok: true }, { match: 'dns.google', ok: true }, { match: '192.168.0.10', ok: true }]),
      now: () => 0,
    });
    expect(out.wifi).toBe('unknown');
    expect(resolveState(out)).not.toBe('S0');
  });

  it('an injected plugin still produces S0 on mobile data', async () => {
    const out = await runProbes(CTX, deps(stubFetch([]), 'cellular'));
    expect(resolveState(out)).toBe('S0');
  });
});

/* ================================================ AC3 - no dead ends, no broken links */

describe('AC3 - the tree is navigable', () => {
  it('every screen offers at least one action', () => {
    for (const [id, s] of Object.entries(TREE.screens)) {
      expect(s.actions.length, `${id} has no actions`).toBeGreaterThan(0);
    }
  });

  it('every action target resolves to a real screen', () => {
    for (const [id, s] of Object.entries(TREE.screens)) {
      for (const a of s.actions) {
        if (a.go) expect(TREE.screens[a.go], `${id} -> ${a.go}`).toBeDefined();
      }
    }
  });

  /**
   * Screens the code routes to on a result rather than on a tap. Each one is named
   * with what pushes it, so an orphan can never be waved away as "probably fine" -
   * if a screen is not tapped to and not listed here, nothing reaches it and it is
   * dead copy.
   */
  const PROGRAMMATIC_ENTRIES: Record<string, string> = {
    'IB-108': 'IB-107 on a recognised router, while the change is verified',
    'IB-109': 'IB-107 or IB-108 when the router change could not be made or confirmed',
    'IB-302': 'IB-301 once a site has been entered',
    'IB-303': 'IB-302 when the box confirms it blocked the site',
    'IB-306': 'IB-302 when the box is not blocking the site',
  };

  it('every screen is reachable, by a tap or by a named result', () => {
    const seen = new Set<string>();
    const walk = (id: string) => {
      if (seen.has(id) || !TREE.screens[id]) return;
      seen.add(id);
      for (const a of TREE.screens[id].actions) if (a.go) walk(a.go);
    };
    walk(TREE.root);
    for (const id of Object.values(TREE.stateScreens)) walk(id);
    for (const id of Object.keys(PROGRAMMATIC_ENTRIES)) walk(id);

    const orphans = Object.keys(TREE.screens).filter((id) => !seen.has(id));
    expect(orphans).toEqual([]);
  });

  it('every programmatic entry point is a real screen', () => {
    for (const id of Object.keys(PROGRAMMATIC_ENTRIES)) {
      expect(TREE.screens[id], id).toBeDefined();
    }
  });

  it('no screen has more than one primary action', () => {
    for (const [id, s] of Object.entries(TREE.screens)) {
      const primaries = s.actions.filter((a) => a.weight === 'primary').length;
      expect(primaries, `${id} has ${primaries} primary actions`).toBeLessThanOrEqual(1);
    }
  });
});

/* ============================================================== copy discipline */

describe('copy rules', () => {
  const BANNED = [
    'DNS', 'DHCP', 'resolver', 'Pi-hole', 'pihole', 'container',
    'upstream', 'ARP', 'nftables', 'unbound',
  ];

  /**
   * "DNS", "DHCP" and "IPv6" survive in exactly two screens, and only inside a step
   * that tells the customer to find that literal word in their own router's menu.
   * Sending someone to look for "the name lookup setting" in a menu that says DHCP
   * is not plain language, it is a wrong instruction.
   *
   * Everywhere else these are banned. A customer who understands the word "resolver"
   * did not need Ionibot. This allow-list is deliberately per-screen and per-word so
   * it cannot quietly grow into a general exemption.
   */
  const ALLOWED_JARGON: Record<string, string[]> = {
    // ADR-001: IB-110 now sends the customer to the router's Internet/WAN section,
    // so it no longer needs "DHCP" — and must not use it, because naming DHCP is
    // what would send them to the setting we deliberately leave alone. "DNS" stays
    // because that is the literal label printed in the router's own menu.
    'IB-110': ['DNS'],
    // 'IB-205' was deleted by the ADR-001 rewrite. Do not re-add an entry here
    // without the screen: an allow-list naming a screen that does not exist is how
    // a jargon exemption outlives the copy it was granted for.
  };

  it('body copy carries no jargon', () => {
    for (const [id, s] of Object.entries(TREE.screens)) {
      const text = [...(s.body ?? []), ...(s.steps ?? []), s.title].join(' ');
      for (const word of BANNED) {
        if (ALLOWED_JARGON[id]?.includes(word)) continue;
        expect(text.includes(word), `${id} uses "${word}"`).toBe(false);
      }
    }
  });

  it('never says error or failed without an action', () => {
    for (const [id, s] of Object.entries(TREE.screens)) {
      const text = [...(s.body ?? []), ...(s.steps ?? [])].join(' ').toLowerCase();
      if (text.includes('error') || text.includes('failed')) {
        expect(s.actions.length, `${id}`).toBeGreaterThan(0);
      }
    }
  });

  it('every placeholder used has a substitution available', () => {
    const known = ['gateway', 'nodeIp', 'site', 'time', 'list', 'category', 'categoryBreaks', 'contact'];
    for (const [id, s] of Object.entries(TREE.screens)) {
      const text = [...(s.body ?? []), ...(s.steps ?? []), s.title, ...s.actions.map((a) => a.label)].join(' ');
      for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) {
        expect(known, `${id} uses {{${m[1]}}}`).toContain(m[1]);
      }
    }
  });

  it('an unknown placeholder renders as nothing, never "undefined"', () => {
    expect(fill('a {{nope}} b', {})).toBe('a  b');
    expect(fill('at {{gateway}}', { gateway: '192.168.0.1' })).toBe('at 192.168.0.1');
  });
});

/* =========================================== architecture-dependent copy is marked */

describe('ADR-001 - the box is an upstream, so a dead box is not an outage', () => {
  /**
   * ADR-001 was accepted 2026-08-24. The router forwards to us as its upstream and
   * devices are never pointed at us, so nothing is taken away from the router and a
   * dead box costs filtering rather than internet.
   *
   * The five screens that used to carry architectureDependent have been rewritten,
   * so the set is now empty. The flag itself is deliberately kept: it is the
   * tripwire for a future feature reintroducing a dependency only the living box
   * can undo. Flag it there and this test makes it visible.
   */
  it('no screen depends on the box being alive for the internet to work', () => {
    const marked = Object.values(TREE.screens)
      .filter((s) => s.architectureDependent)
      .map((s) => s.id)
      .sort();
    expect(marked).toEqual([]);
  });

  it('deleted the hand-revert emergency walkthrough', () => {
    // IB-205 talked the customer through undoing the router change to get their
    // internet back. There is no such emergency now, and a screen that invents one
    // teaches the customer to distrust the box.
    expect(TREE.screens['IB-205']).toBeUndefined();
  });

  /**
   * The load-bearing copy assertion. IB-204 is what a customer reads when their box
   * is off. Under the old model it told them their websites would not load until it
   * came back. Saying that now is a false alarm that sends them to unplug things.
   */
  it('never tells the customer that a dead box takes their internet down', () => {
    for (const [id, s] of Object.entries(TREE.screens)) {
      const text = [...(s.body ?? []), ...(s.steps ?? []), s.title].join(' ').toLowerCase();
      const claimsOutage =
        text.includes('websites will not load until') ||
        text.includes('websites will stop loading') ||
        text.includes('your internet will be down');
      expect(claimsOutage, `${id} claims a dead box is an internet outage`).toBe(false);
    }
  });

  /**
   * ADR-001 accepted, in terms, that filtering is not total, and said the copy must
   * not imply otherwise. IB-112 is the end of setup — the single most likely place
   * to overclaim, because it is the screen that wants to congratulate the customer.
   */
  it('does not promise total coverage at the end of setup', () => {
    const done = TREE.screens['IB-112'];
    expect(done).toBeDefined();
    const text = (done.body ?? []).join(' ');
    expect(text.toLowerCase()).not.toContain('every device');
    // Must actively say coverage is imperfect, not merely avoid saying it is total.
    expect(/hundred percent|100%|not.*perfect|go straight out/i.test(text)).toBe(true);
  });

  /**
   * IB-110 is the one screen that changes the customer's router. Pointing it back at
   * the DHCP/LAN section would silently restore the Class A outage the ADR removed,
   * and would do it in a place nobody re-reads. This is the guard against that.
   */
  it('changes the router upstream, never the setting that hands addresses to devices', () => {
    const s = TREE.screens['IB-110'];
    const steps = (s.steps ?? []).join(' ');
    expect(steps).toMatch(/Internet or WAN/i);
    expect(steps).not.toMatch(/DHCP/i);
    expect(steps).not.toMatch(/\bLAN settings\b/i);
  });
});

/* ============================================================= netcheck fix order */

describe('netcheck failures are presented in fix order, never by severity', () => {
  it('orders router, then ipv6, then dual-homing, then rate limiting', () => {
    const report = r({
      netcheck: NC([
        { status: 'FAIL', check: 'ratelimit', message: '' },
        { status: 'FAIL', check: 'ipv6', message: '' },
        { status: 'PASS', check: 'filtering', message: '' },
        { status: 'FAIL', check: 'router', message: '' },
        { status: 'FAIL', check: 'dualhome', message: '' },
      ]),
    });
    expect(orderedFailures(report).map((x) => x.check)).toEqual([...FIX_ORDER]);
  });

  it('passes and warnings are not presented as failures', () => {
    const report = r({
      netcheck: NC([
        { status: 'PASS', check: 'router', message: '' },
        { status: 'WARN', check: 'ipv6', message: '' },
      ]),
    });
    expect(orderedFailures(report)).toEqual([]);
  });
});

/* ================================================== the probe layer, end to end */

describe('probe sweep', () => {
  it('short-circuits on mobile data without touching the network', async () => {
    let calls = 0;
    const f = (async () => { calls++; throw new TypeError('should not be called'); }) as unknown as typeof fetch;
    const out = await runProbes(CTX, deps(f, 'cellular'));
    expect(out.wifi).toBe('fail');
    expect(calls).toBe(0);
    expect(resolveState(out)).toBe('S0');
  });

  it('short-circuits when there is no internet path at all', async () => {
    const out = await runProbes(CTX, deps(stubFetch([{ match: '192.168.0.10', ok: true }])));
    expect(out.rawIp).toBe('fail');
    expect(out.dns).toBe('unknown'); // never asked - the answer could not matter
    expect(resolveState(out)).toBe('S1');
  });

  /**
   * The load-bearing case. The raw-IP probe uses an IP literal so it needs no name
   * lookup; the DNS probe uses a hostname so it does. If a future edit ever points
   * the raw-IP probe at a hostname, this test fails and the whole diagnostic
   * silently stops being able to tell "our fault" from "their fault".
   */
  it('separates a name-lookup fault from a line fault', async () => {
    const out = await runProbes(
      CTX,
      deps(stubFetch([
        { match: '1.1.1.1', ok: true },        // IP literal: reachable
        { match: 'dns.google', throws: true }, // hostname: cannot resolve
        { match: 'one.one.one.one', throws: true },
        { match: '8.8.8.8', ok: true },
        { match: '192.168.0.10', throws: true },
      ])),
    );
    expect(out.rawIp).toBe('pass');
    expect(out.dns).toBe('fail');
    expect(resolveState(out)).toBe('S2');
  });

  /**
   * The netcheck route is read-scoped, so an unpaired handset gets a 401. That
   * must degrade to "I could not read the report", never to a clean bill of
   * health — a 401 body is not a report and must not be parsed as one.
   */
  it('an unpaired handset cannot read netcheck, and does not pretend otherwise', async () => {
    const out = await runProbes(CTX, {
      ...deps(stubFetch([
        { match: '1.1.1.1', ok: true },
        { match: 'dns.google', throws: true },
        { match: 'one.one.one.one', throws: true },
        { match: 'netcheck', ok: false },
        { match: 'system/status', ok: true },
      ])),
      authToken: () => null,
    });
    expect(out.listener).toBe('unknown');
    expect(resolveState(out)).toBe('S3');
    expect(resolveState(out)).not.toBe('S4');
  });

  it('sends the paired token so the read-scoped route answers', async () => {
    const headers: (HeadersInit | undefined)[] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('netcheck')) headers.push(init?.headers);
      if (String(input).includes('dns.google') || String(input).includes('one.one')) {
        throw new TypeError('no dns');
      }
      return { ok: true, json: async () => NC([]) } as Response;
    }) as unknown as typeof fetch;

    await runProbes(CTX, { ...deps(f), authToken: () => 'abc123' });
    expect(headers[0]).toEqual({ Authorization: 'Bearer abc123' });
  });

  it('reads the listener state from the box rather than deriving its own', async () => {
    const out = await runProbes(
      CTX,
      deps(stubFetch([
        { match: '1.1.1.1', ok: true },
        { match: 'dns.google', throws: true },
        { match: 'one.one.one.one', throws: true },
        { match: 'netcheck', ok: true, json: NC([{ status: 'PASS', check: 'lanlistener', message: '' }]) },
        { match: 'system/status', ok: true },
      ])),
    );
    expect(out.listener).toBe('pass');
    expect(resolveState(out)).toBe('S4');
  });

  it('does not ask the box for anything when the box is unreachable', async () => {
    const seen: string[] = [];
    const f = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('192.168.0.10')) throw new TypeError('down');
      if (url.includes('dns.google') || url.includes('one.one')) throw new TypeError('no dns');
      return { ok: true, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    await runProbes(CTX, deps(f));
    expect(seen.some((u) => u.includes('netcheck'))).toBe(false);
  });

  it('tolerates a missing node address without throwing', async () => {
    const out = await runProbes({ ...CTX, nodeIp: null }, deps(stubFetch([{ match: '1.1.1.1', ok: true }])));
    expect(out.node).toBe('unknown');
    expect(() => resolveState(out)).not.toThrow();
  });
});

/* ==================================================== AC5 - contract pinning */

describe('AC5 - the tree is pinned to the box it talks to', () => {
  it('declares a netcheck contract version', () => {
    // If the agent's netcheck grows or renames a check, this must be bumped and a
    // branch added. A silent drift is how a customer gets told a broken box is fine.
    expect(TREE.netcheckContract).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(TREE.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
