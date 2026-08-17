/**
 * Contract tests for the node discovery candidate list.
 *
 * WHY THESE EXIST
 *
 * Defect 1 of the 2026-08-15 deployment failures: six of eight candidates
 * omitted `:8080`. The agent binds 8080, so a bare host resolves to :80 and
 * every probe failed. The effect was that a phone could only ever find a node
 * over its own loopback - on a real LAN it always reported "No Gate^Flame node
 * found", with no way to recover.
 *
 * That defect lived in code that type-checked, built clean and had passing
 * tests. The tests stubbed `fetch` and never asserted a port. These are the
 * tests that would have caught it.
 */

import { describe, expect, it } from 'vitest';

import { config } from './env';

const AGENT_PORT = '8080';

/**
 * One documented exception: a bare port-80 name kept last for the day the
 * agent sits behind a reverse proxy. Listed explicitly so that adding a NEW
 * port-less entry fails, while the intentional one does not.
 */
const DOCUMENTED_PORTLESS = new Set(['http://gateflame.local']);

const candidates = config.discoveryCandidates as readonly string[];

describe('discoveryCandidates', () => {
  it('is not empty', () => {
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('every candidate carries an explicit port, except the documented one', () => {
    const offenders = candidates.filter((url) => {
      if (DOCUMENTED_PORTLESS.has(url)) return false;
      return new URL(url).port === '';
    });

    expect(
      offenders,
      `these candidates have no explicit port and would resolve to :80, which the ` +
        `agent does not bind:\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every ported candidate uses the port the agent actually binds', () => {
    const wrong = candidates
      .map((url) => new URL(url))
      .filter((u) => u.port !== '' && u.port !== AGENT_PORT)
      .map((u) => u.href);

    expect(wrong, `expected :${AGENT_PORT}`).toEqual([]);
  });

  it('every IP-literal candidate is RFC1918, loopback or link-local', () => {
    // A public address here would mean the app probes the open internet for a
    // node, and assertPrivateHost would refuse it at runtime anyway.
    const isPrivate = (host: string): boolean => {
      const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
      if (!m) return true; // hostname, not an IP literal - out of scope here
      const [a, b] = [Number(m[1]), Number(m[2])];
      return (
        a === 127 ||
        a === 10 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)
      );
    };

    const publicOnes = candidates
      .map((url) => new URL(url))
      .filter((u) => !isPrivate(u.hostname))
      .map((u) => u.href);

    expect(publicOnes).toEqual([]);
  });

  it('contains no duplicates', () => {
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it('includes an mDNS name, so discovery works without knowing any IP', () => {
    const mdns = candidates.filter((u) => new URL(u).hostname.endsWith('.local'));
    expect(mdns.length).toBeGreaterThan(0);
  });

  it('includes raspberrypi.local, which works before the avahi alias is published', () => {
    // Raspberry Pi OS publishes <hostname>.local out of the box and the stock
    // hostname is `raspberrypi`. gateflame.local only exists once
    // deploy-on-pi.sh has run its avahi step, so this is the first-run path.
    expect(candidates).toContain(`http://raspberrypi.local:${AGENT_PORT}`);
  });

  it('tries loopback, for the kiosk talking to its own agent', () => {
    const loopback = candidates.filter((u) => {
      const h = new URL(u).hostname;
      return h === 'localhost' || h === '127.0.0.1';
    });
    expect(loopback.length).toBeGreaterThan(0);
  });
});
