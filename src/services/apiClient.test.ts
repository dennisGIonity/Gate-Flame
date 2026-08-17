/**
 * Gate^Flame — apiClient tests.
 *
 * The two properties this module exists to guarantee:
 *
 *  1. Every request has a deadline. A node that is powered off must fail in
 *     `apiTimeoutMs`, not hang the dashboard until the browser gives up.
 *  2. Failures are *classified*. `isUnreachable` is the discriminator the whole
 *     live-vs-demo decision in gateflameApi is built on: "nothing answered"
 *     falls back to the simulator, "something answered and refused" must not.
 *     Getting that one boolean wrong turns a 403 into silently fabricated
 *     security telemetry, so it is tested per failure mode.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiRequestError,
  apiRequest,
  assertPrivateHost,
  clearToken,
  hasToken,
  storeToken,
} from './apiClient';
import { config } from '../config/env';

const BASE = 'http://gateflame.local';
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A fetch that never settles until its own signal aborts. */
const hangingFetch = () =>
  vi.fn((_url: string, init: RequestInit = {}) => {
    return new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
    });
  });

describe('apiRequest', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe('URL and request shape', () => {
    it('joins baseUrl, the /api/v1 prefix and the path', async () => {
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ ok: true }));
      vi.stubGlobal('fetch', fetchMock);

      await apiRequest(BASE, '/telemetry/summary');

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${BASE}${config.apiPrefix}/telemetry/summary`,
      );
    });

    it('sends no cookies and no cache for LAN bearer-token requests', async () => {
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      await apiRequest(BASE, '/clients');

      const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect(init.credentials).toBe('omit');
      expect(init.cache).toBe('no-store');
    });

    it('only sets Content-Type when there is a body, and serialises it', async () => {
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      await apiRequest(BASE, '/services/x/start', { method: 'POST' });
      const withoutBody = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
      expect((withoutBody.headers as Record<string, string>)['Content-Type']).toBeUndefined();
      expect(withoutBody.body).toBeUndefined();

      await apiRequest(BASE, '/pair/claim', { method: 'POST', body: { code: '123456' } });
      const withBody = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
      expect((withBody.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      expect(withBody.body).toBe('{"code":"123456"}');
    });
  });

  describe('token handling', () => {
    it('reads the token per request, so pairing takes effect without a reload', async () => {
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);

      // First request happens before pairing.
      await apiRequest(BASE, '/clients');
      expect(hasToken()).toBe(false);

      storeToken('tok-abc');
      await apiRequest(BASE, '/clients');

      const headersOf = (i: number) =>
        ((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].headers ??
          {}) as Record<string, string>;
      expect(headersOf(0).Authorization).toBeUndefined();
      expect(headersOf(1).Authorization).toBe('Bearer tok-abc');
    });

    it('omits Authorization when the caller asks to be anonymous', async () => {
      const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}));
      vi.stubGlobal('fetch', fetchMock);
      storeToken('tok-abc');

      await apiRequest(BASE, '/pair/claim', { method: 'POST', anonymous: true });

      const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it('storeToken / hasToken / clearToken round-trip through localStorage', () => {
      expect(hasToken()).toBe(false);
      storeToken('tok-1');
      expect(localStorage.getItem(config.tokenStorageKey)).toBe('tok-1');
      expect(hasToken()).toBe(true);
      clearToken();
      expect(hasToken()).toBe(false);
    });
  });

  describe('timeout behaviour', () => {
    it('gives up after config.apiTimeoutMs and reports a timeout', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', hangingFetch());

      let settled = false;
      const caught = apiRequest(BASE, '/system/status')
        .catch((e: ApiRequestError) => e)
        .finally(() => {
          settled = true;
        });

      // One millisecond short of the deadline the request is still outstanding.
      await vi.advanceTimersByTimeAsync(config.apiTimeoutMs - 1);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const err = (await caught) as ApiRequestError;

      expect(err).toBeInstanceOf(ApiRequestError);
      expect(err.isTimeout).toBe(true);
      expect(err.isNetwork).toBe(false);
      expect(err.isUnreachable).toBe(true);
      expect(err.status).toBe(0);
      expect(err.message).toContain(BASE);
      expect(err.message).toContain(`${config.apiTimeoutMs}ms`);
    });

    it('honours a per-call timeoutMs override', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', hangingFetch());

      const pending = apiRequest(BASE, '/system/status', { timeoutMs: 250 });
      const caught = pending.catch((e: ApiRequestError) => e);

      await vi.advanceTimersByTimeAsync(250);
      const err = await caught;

      expect(err).toBeInstanceOf(ApiRequestError);
      expect((err as ApiRequestError).isTimeout).toBe(true);
      expect((err as ApiRequestError).message).toContain('250ms');
    });

    it('clears its timer on success, so a later tick cannot abort anything', async () => {
      vi.useFakeTimers();
      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ nodeId: 'n1' })));

      await apiRequest(BASE, '/system/status');
      expect(clearSpy).toHaveBeenCalled();

      // Nothing pending: pushing well past the deadline must be a no-op.
      expect(() => vi.advanceTimersByTime(config.apiTimeoutMs * 3)).not.toThrow();
      clearSpy.mockRestore();
    });
  });

  describe('caller cancellation', () => {
    it('reports an unmount-driven abort as cancelled, not as a timeout', async () => {
      vi.stubGlobal('fetch', hangingFetch());
      const controller = new AbortController();

      const pending = apiRequest(BASE, '/telemetry/summary', {
        signal: controller.signal,
      }).catch((e: ApiRequestError) => e);

      controller.abort();
      const err = (await pending) as ApiRequestError;

      expect(err).toBeInstanceOf(ApiRequestError);
      expect(err.message).toBe('Request cancelled');
      expect(err.isTimeout).toBe(false);
      // Cancellation counts as unreachable, so the engine's fallback path — and
      // not its "the node refused us" path — handles a mid-flight unmount.
      expect(err.isNetwork).toBe(true);
      expect(err.isUnreachable).toBe(true);
    });

    it('detaches its abort listener from the caller signal after settling', async () => {
      vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({})));
      const controller = new AbortController();
      const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

      await apiRequest(BASE, '/clients', { signal: controller.signal });

      // Long-lived signals are reused across a session's polls; a listener left
      // behind on each one is an unbounded leak.
      expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    });
  });

  describe('typed error mapping', () => {
    it('carries the status and the parsed body of a JSON error, and is not unreachable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          jsonResponse({ error: 'forbidden', message: 'kiosk scope required' }, 403),
        ),
      );

      const err = (await apiRequest(BASE, '/services/x/stop', { method: 'POST' }).catch(
        (e: ApiRequestError) => e,
      )) as ApiRequestError;

      expect(err).toBeInstanceOf(ApiRequestError);
      expect(err.status).toBe(403);
      expect(err.message).toBe('kiosk scope required');
      expect(err.body).toEqual({ error: 'forbidden', message: 'kiosk scope required' });
      // The node answered. This must never be mistaken for "no node here".
      expect(err.isUnreachable).toBe(false);
    });

    it('falls back to the error field when there is no message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ error: 'pair_code_expired' }, 410)),
      );

      const err = (await apiRequest(BASE, '/pair/claim', { method: 'POST' }).catch(
        (e: ApiRequestError) => e,
      )) as ApiRequestError;

      expect(err.message).toBe('pair_code_expired');
      expect(err.status).toBe(410);
    });

    it('synthesises a message when the error body is not JSON', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 })),
      );

      const err = (await apiRequest(BASE, '/telemetry/summary').catch(
        (e: ApiRequestError) => e,
      )) as ApiRequestError;

      expect(err.status).toBe(502);
      expect(err.body).toBeNull();
      expect(err.message).toBe('GET /telemetry/summary failed with 502');
    });

    it('maps a transport failure to isNetwork and keeps the underlying message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      );

      const err = (await apiRequest(BASE, '/system/status').catch(
        (e: ApiRequestError) => e,
      )) as ApiRequestError;

      expect(err.isNetwork).toBe(true);
      expect(err.isTimeout).toBe(false);
      expect(err.isUnreachable).toBe(true);
      expect(err.status).toBe(0);
      expect(err.message).toBe('Failed to fetch');
    });

    it('is named ApiRequestError so instanceof survives the useGateFlameEngine rethrow', async () => {
      vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ error: 'nope' }, 500)));

      const err = (await apiRequest(BASE, '/x').catch((e: ApiRequestError) => e)) as Error;

      expect(err.name).toBe('ApiRequestError');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('successful responses', () => {
    it('returns the parsed JSON body', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ nodeId: 'gf-1', agentVersion: '1.2.3' })),
      );

      await expect(apiRequest(BASE, '/system/status')).resolves.toEqual({
        nodeId: 'gf-1',
        agentVersion: '1.2.3',
      });
    });

    it('returns undefined for 204 rather than trying to parse an empty body', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));

      await expect(apiRequest(BASE, '/pair/devices/abc', { method: 'DELETE' })).resolves.toBeUndefined();
    });
  });
});

describe('assertPrivateHost — the RFC1918 guard the Android manifest cannot express', () => {
  const allowed = [
    'http://192.168.1.105:8080',
    'http://192.168.0.7',
    'http://10.4.19.200:8080',
    'http://172.16.0.5:8080',
    'http://172.31.255.254',
    'http://169.254.10.1:8080',
    'http://127.0.0.1:8080',
    'http://localhost:8080',
    'http://gateflame.local:8080',
    'https://feeds.ionity.today',
  ];

  const refused = [
    'http://8.8.8.8:8080',
    'http://172.32.0.1:8080',
    'http://172.15.255.255:8080',
    'http://11.0.0.1:8080',
    'http://192.169.1.1:8080',
    'http://feeds.ionity.today',
    'http://evil.example.com',
  ];

  it.each(allowed)('permits %s', (url) => {
    expect(() => assertPrivateHost(url)).not.toThrow();
  });

  it.each(refused)('refuses %s', (url) => {
    expect(() => assertPrivateHost(url)).toThrow(ApiRequestError);
  });
});
