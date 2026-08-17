/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: contract tests
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * These pin the three promises the console makes that are cheap to break by
 * accident and expensive to discover on a customer's wall.
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DASH, apiRoot, bytes, consoleAuthority, duration, num, pct } from './kioskClient';
import { NotTheConsole, StatusPill } from './kioskUi';

/** jsdom lets us restate window.location per case. */
function atLocation(href: string) {
  const url = new URL(href);
  vi.stubGlobal('location', {
    ...window.location,
    href,
    origin: url.origin,
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('console authority comes from the socket, not the URL path', () => {
  // The defect this replaces: isKioskContext() in src/config/env.ts returns
  // true for ANY path containing 'device-kiosk'. The node grants `kiosk` scope
  // only to a loopback source address, so a phone opening
  // http://192.168.0.10:8080/device-kiosk got a page that believed it was the
  // appliance console and then took a 401 the first time a button was pressed.
  // Proven against a live agent: 127.0.0.1 allowed, 192.168.0.10 refused.
  it('grants console authority to loopback', () => {
    atLocation('http://localhost:8080/device-kiosk/');
    expect(consoleAuthority()).toBe('console');

    atLocation('http://127.0.0.1:8080/device-kiosk/');
    expect(consoleAuthority()).toBe('console');
  });

  it("refuses console authority to the node's own LAN address", () => {
    atLocation('http://192.168.0.10:8080/device-kiosk/');
    expect(consoleAuthority()).toBe('viewer');
  });

  it('refuses console authority to a hostname that merely looks like the kiosk', () => {
    atLocation('http://gateflame.local:8080/device-kiosk/');
    expect(consoleAuthority()).toBe('viewer');
  });
});

describe('the console talks to the node that served it', () => {
  it('uses the serving origin rather than a hardcoded port', () => {
    // GATEFLAME_PORT is configurable, and a hardcoded localhost:8080 would
    // also mean a page opened against node B quietly controlling node A.
    atLocation('http://192.168.0.10:9090/device-kiosk/');
    expect(apiRoot()).toBe('http://192.168.0.10:9090/api/v1');
  });

  it('falls back to the agent port when served by the vite dev server', () => {
    atLocation('http://localhost:3000/kiosk.html');
    expect(apiRoot()).toBe('http://localhost:8080/api/v1');
  });
});

describe('unknown is never rendered as a number', () => {
  it('returns the em-dash for null and undefined', () => {
    for (const f of [num, pct, bytes, duration]) {
      expect(f(null)).toBe(DASH);
      expect(f(undefined)).toBe(DASH);
    }
  });

  it('still renders a real zero, because zero is a measurement', () => {
    expect(num(0)).toBe('0');
    expect(pct(0)).toBe('0.0%');
    expect(bytes(0)).toBe('0 B');
    expect(duration(0)).toBe('0s');
  });
});

describe('a module carrying a gap never shows green', () => {
  // "Never render a green indicator next to a module that carries a gap" is a
  // promise the product makes to a customer. It is enforced in StatusPill so it
  // cannot be forgotten at one call site out of nine.
  it('downgrades running+gap to degraded', () => {
    render(<StatusPill status="running" hasGap />);
    expect(screen.getByText('Degraded')).toBeInTheDocument();
    expect(screen.queryByText('Running')).not.toBeInTheDocument();
  });

  it('leaves a clean running module alone', () => {
    render(<StatusPill status="running" />);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});

describe('a LAN browser is told it was refused, not shown an empty dashboard', () => {
  // Measured against the live node 2026-08-17: every scoped read returned 401
  // from the LAN, while /system/status and /system/kiosk answered. The console
  // must distinguish "refused" from "unreachable" and from "zero".
  it('renders the refusal explanation with the node identity', () => {
    render(<NotTheConsole nodeId="GF-72TYTITQ" kioskPath="/device-kiosk" />);
    expect(screen.getByText(/not the appliance console/i)).toBeInTheDocument();
    expect(screen.getByText(/GF-72TYTITQ/)).toBeInTheDocument();
    expect(screen.getByText(/401/)).toBeInTheDocument();
  });

  it('says the node is running, so nobody goes hunting for a fault', () => {
    render(<NotTheConsole nodeId="GF-72TYTITQ" kioskPath="/device-kiosk" />);
    expect(screen.getByText(/security model working, not a\s+fault/i)).toBeInTheDocument();
  });
});
