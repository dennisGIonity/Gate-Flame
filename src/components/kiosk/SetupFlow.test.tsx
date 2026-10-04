/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame on-device console: setup flow tests
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SetupFlow from './SetupFlow';

type Handler = (init: RequestInit | undefined) => { status?: number; body: unknown };
let routes: Record<string, Handler>;
let calls: { path: string; init?: RequestInit }[];

beforeEach(() => {
  routes = {};
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/v1/, '');
    calls.push({ path, init });
    const h = routes[`${init?.method ?? 'GET'} ${path}`];
    if (!h) return new Response(JSON.stringify({ detail: 'not scripted' }), { status: 404 });
    const { status = 200, body } = h(init);
    return new Response(JSON.stringify(body), { status });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const net = (over: Record<string, unknown> = {}) => ({
  wired: { present: true, up: true, address: '192.168.124.3' },
  wifi: { present: true, connected: false, ssid: null, address: null, signal: null },
  boxAddress: '192.168.124.3',
  internet: true,
  gap: null,
  ...over,
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('step 1: connect', () => {
  it('holds Continue back until the box has an address, and says why', async () => {
    routes['GET /network/status'] = () => ({ body: net({ boxAddress: null, wired: { present: true, up: false, address: null } }) });
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    const btn = screen.getByRole('button', { name: /^continue$/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/Continue unlocks once the box has an address/)).toBeTruthy();
  });

  it('shows the wired address as the box address and enables Continue', async () => {
    routes['GET /network/status'] = () => ({ body: net() });
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    expect(screen.getAllByText('192.168.124.3').length).toBeGreaterThan(0);
    expect((screen.getByRole('button', { name: /^continue$/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders the node\'s gap sentence verbatim and "internet: null" as a dash, not "not reachable"', async () => {
    routes['GET /network/status'] = () => ({ body: net({ internet: null, gap: 'NetworkManager is not available on this box' }) });
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    expect(screen.getByText('NetworkManager is not available on this box')).toBeTruthy();
    expect(screen.queryByText('not reachable')).toBeNull();
  });

  it('types a password on the glass, sends it once, and never leaves it in the DOM after a failure', async () => {
    routes['GET /network/status'] = () => ({ body: net({ boxAddress: null }) });
    routes['GET /network/wifi/scan'] = () => ({ body: { networks: [{ ssid: 'Home', signal: 80, security: 'WPA2' }], gap: null } });
    let sent: unknown = null;
    routes['POST /network/wifi/connect'] = (init) => {
      sent = JSON.parse(String(init?.body));
      return { status: 409, body: { ok: false, error: 'wrong_password', detail: '“Home” did not accept that password.' } };
    };
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /scan/i }));
    await flush();
    fireEvent.click(await screen.findByText('Home'));
    for (const ch of 'abc12345') fireEvent.click(screen.getByRole('button', { name: ch }));
    // Hidden by default.
    expect(screen.getByTestId('password-field').textContent).not.toContain('abc12345');
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(screen.getByText('“Home” did not accept that password.')).toBeTruthy());
    expect(sent).toEqual({ ssid: 'Home', password: 'abc12345' });
    // Cleared the moment the node answered.
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByTestId('password-field').textContent).not.toContain('abc12345');
    expect(document.body.innerHTML).not.toContain('abc12345');
  });

  it('joins an open network without sending a password', async () => {
    routes['GET /network/status'] = () => ({ body: net({ boxAddress: null }) });
    routes['GET /network/wifi/scan'] = () => ({ body: { networks: [{ ssid: 'Cafe', signal: 60, security: 'open' }], gap: null } });
    let sent: any = null;
    routes['POST /network/wifi/connect'] = (init) => {
      sent = JSON.parse(String(init?.body));
      return { body: { ok: true, address: '192.168.0.50' } };
    };
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /scan/i }));
    fireEvent.click(await screen.findByText('Cafe'));
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    await waitFor(() => expect(sent).toEqual({ ssid: 'Cafe', password: null }));
  });
});

describe('step 2: the router read-back', () => {
  async function toRouter(check: Record<string, unknown> | { status: number; body: unknown }) {
    routes['GET /network/status'] = () => ({ body: net() });
    routes['GET /network/router-check'] = () => ('body' in check ? (check as any) : { body: check });
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await flush();
  }
  const rc = (forwardsToUs: boolean | null, gap: string | null = null) => ({
    gateway: '192.168.124.1', boxAddress: '192.168.124.3', forwardsToUs, method: 'canary', checkedAt: 1, gap,
  });

  it('shows the address to type into the router, large', async () => {
    await toRouter(rc(null, 'x'));
    expect(screen.getByTestId('box-address').textContent).toBe('192.168.124.3');
  });

  it('true says yes', async () => {
    await toRouter(rc(true));
    expect(screen.getByText(/your router is sending its lookups to this box/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^continue$/i })).toBeTruthy();
  });

  it('false says not yet, and offers "Continue anyway"', async () => {
    await toRouter(rc(false));
    expect(screen.getByText(/Not yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /continue anyway/i })).toBeTruthy();
  });

  it('null says could not check, shows the node\'s gap, and NEVER says the router is not forwarding', async () => {
    await toRouter(rc(null, 'Your router (192.168.124.1) did not answer a DNS lookup within 3 seconds, so this box cannot tell whether it passes lookups here'));
    expect(screen.getByText(/Could not check yet/)).toBeTruthy();
    expect(screen.getByText(/did not answer a DNS lookup within 3 seconds/)).toBeTruthy();
    expect(screen.queryByText(/Not yet/)).toBeNull();
    expect(screen.queryByText(/is not sending its lookups/)).toBeNull();
    expect(screen.queryByText(/^Yes/)).toBeNull();
  });
});

describe('step 3: pairing', () => {
  async function toPair() {
    routes['GET /network/status'] = () => ({ body: net() });
    routes['GET /network/router-check'] = () => ({ body: { gateway: null, boxAddress: '192.168.124.3', forwardsToUs: null, method: null, checkedAt: null, gap: 'g' } });
    fireEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    await flush();
    fireEvent.click(screen.getByRole('button', { name: /continue anyway/i }));
    await flush();
  }

  it('shows the code the node issued and nothing it did not', async () => {
    routes['POST /pair/request'] = () => ({ status: 201, body: { code: '123456', expiresAt: new Date(Date.now() + 300000).toISOString(), attemptsRemaining: 5 } });
    routes['GET /pair/devices'] = () => ({ body: { devices: [] } });
    routes['GET /network/status'] = () => ({ body: net() });
    routes['GET /network/router-check'] = () => ({ body: { gateway: null, boxAddress: '192.168.124.3', forwardsToUs: null, method: null, checkedAt: null, gap: 'g' } });
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    await toPair();
    expect(screen.getByTestId('pairing-code').textContent).toBe('123456');
  });

  it('a node that will not issue a code shows no digits at all', async () => {
    routes['POST /pair/request'] = () => ({ status: 429, body: { detail: 'Too many codes requested; wait a minute.' } });
    routes['GET /pair/devices'] = () => ({ body: { devices: [] } });
    routes['GET /network/status'] = () => ({ body: net() });
    routes['GET /network/router-check'] = () => ({ body: { gateway: null, boxAddress: '192.168.124.3', forwardsToUs: null, method: null, checkedAt: null, gap: 'g' } });
    render(<SetupFlow onFinish={() => {}} />);
    await flush();
    await toPair();
    expect(screen.getByText('Could not issue a code')).toBeTruthy();
    expect(screen.getByText('Too many codes requested; wait a minute.')).toBeTruthy();
    expect(screen.queryByTestId('pairing-code')).toBeNull();
  });

  it('moves to "Phone paired" by itself when a device appears, and Done finishes setup', async () => {
    routes['POST /pair/request'] = () => ({ status: 201, body: { code: '654321', expiresAt: new Date(Date.now() + 300000).toISOString(), attemptsRemaining: 5 } });
    routes['GET /network/status'] = () => ({ body: net() });
    routes['GET /network/router-check'] = () => ({ body: { gateway: null, boxAddress: '192.168.124.3', forwardsToUs: null, method: null, checkedAt: null, gap: 'g' } });
    let paired = false;
    routes['GET /pair/devices'] = () => ({ body: { devices: paired ? [{ id: 'd1', deviceName: 'Dennis phone' }] : [] } });
    const onFinish = vi.fn();
    render(<SetupFlow onFinish={onFinish} />);
    await flush();
    await toPair();
    paired = true;
    await waitFor(() => expect(screen.getByText('Phone paired')).toBeTruthy(), { timeout: 5000 });
    expect(screen.getByText('Dennis phone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
