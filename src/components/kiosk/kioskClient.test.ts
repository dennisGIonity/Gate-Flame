/* ========================================================================================
 * GATE^FLAME - THE SHARED NODE CLIENT: REVOCATION, REFRESH, AND POLLING IN A POCKET
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * Three defects found in the 2026-10-02 mobile pass, each pinned here so it cannot
 * come back quietly:
 *
 *  1. A 401 to a request that CARRIED the paired token never reached the app. Every
 *     phone screen polls through nodeRequest, so a handset revoked at the kiosk kept
 *     its dead token and showed "Cannot see your box" forever. The transport now has
 *     an onUnauthorized hook; the phone wires it to apiClient.rejectToken.
 *  2. usePolled's in-flight guard was a ref shared across polling cycles, so
 *     refresh() while a request was still open did nothing until the next interval.
 *  3. usePolled kept polling while the page was hidden and showed stale figures for
 *     up to one interval after coming back.
 *
 * Non-vacuity was checked by reverting each fix in turn and watching its test fail.
 * ======================================================================================== */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureNodeTransport, NodeError, nodeRequest, usePolled } from './kioskClient';

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: FetchMock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  configureNodeTransport(null);
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ 401 hook */

describe('nodeRequest tells the host when the node rejects the token it sent', () => {
  it('fires onUnauthorized on a 401 to a request that carried a bearer token', async () => {
    const onUnauthorized = vi.fn();
    configureNodeTransport({
      baseUrl: 'http://192.168.0.10:8080',
      authToken: () => 'gf_dev_token',
      onUnauthorized,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'device token revoked' }));

    await expect(nodeRequest('/telemetry/summary')).rejects.toBeInstanceOf(NodeError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    // And the request really did carry the token - the hook is not firing on a
    // stranger's refusal.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gf_dev_token');
  });

  it('does NOT fire when no token was sent - a 401 to an anonymous request is not a revocation', async () => {
    const onUnauthorized = vi.fn();
    configureNodeTransport({
      baseUrl: 'http://192.168.0.10:8080',
      authToken: () => null,
      onUnauthorized,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'kiosk scope required' }));

    await expect(nodeRequest('/pair/request', { method: 'POST' })).rejects.toBeInstanceOf(NodeError);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does NOT fire on any other refusal', async () => {
    const onUnauthorized = vi.fn();
    configureNodeTransport({
      baseUrl: 'http://192.168.0.10:8080',
      authToken: () => 'gf_dev_token',
      onUnauthorized,
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { detail: 'forbidden' }));
    await expect(nodeRequest('/filtering')).rejects.toMatchObject({ status: 403 });

    fetchMock.mockResolvedValueOnce(jsonResponse(503, { detail: 'Pi-hole unreachable' }));
    await expect(nodeRequest('/filtering')).rejects.toMatchObject({ status: 503 });

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('still surfaces the node’s own sentence after notifying the host', async () => {
    configureNodeTransport({
      baseUrl: 'http://192.168.0.10:8080',
      authToken: () => 'gf_dev_token',
      onUnauthorized: () => {
        throw new Error('a broken host hook');
      },
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'device token revoked' }));

    // The hook throwing must not swallow the real error or change its shape.
    await expect(nodeRequest('/telemetry/summary')).rejects.toMatchObject({
      message: 'device token revoked',
      status: 401,
      unreachable: false,
    });
  });

  it('the console (no transport) sends no token and has nothing to be told', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { detail: 'kiosk scope required' }));
    await expect(nodeRequest('/pair/devices/revoke-all', { method: 'POST' })).rejects.toMatchObject({
      status: 401,
    });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toBeUndefined();
  });
});

/* ----------------------------------------------------------------- usePolled */

/** Resolve the first poll with a payload the test can recognise. */
function okOnce(payload: unknown) {
  fetchMock.mockResolvedValueOnce(jsonResponse(200, payload));
}

/** A fetch that never settles until the test says so. */
function pending() {
  let resolve!: (r: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  fetchMock.mockReturnValueOnce(promise);
  return (payload: unknown) => resolve(jsonResponse(200, payload));
}

describe('usePolled: refresh() is never swallowed by a request that is still open', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('issues a new request immediately when refresh() is called mid-flight', async () => {
    const settleFirst = pending(); // the first poll hangs
    okOnce({ n: 2 }); // what the refresh should fetch

    const { result } = renderHook(() => usePolled<{ n: number }>('/filtering', 60_000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Someone taps a control and the screen asks for a re-read while the
    // first request is still waiting on a slow Pi.
    act(() => result.current.refresh());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // With the shared in-flight ref this was 1: the new cycle saw "busy" and
    // gave up, and nothing refreshed until the next interval (60 s here).
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual({ n: 2 });

    // The abandoned first request settling late must not overwrite the fresh
    // reading with an older one.
    settleFirst({ n: 1 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual({ n: 2 });
  });

  it('keeps one request in flight at a time within a cycle', async () => {
    pending();
    renderHook(() => usePolled('/telemetry/summary', 1000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    // Three intervals passed behind a stalled node; none of them stacked up.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('usePolled: parks while hidden, fetches the moment it is visible again', () => {
  let hidden = false;

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  });

  afterEach(() => {
    hidden = false;
  });

  const goHidden = () => {
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const comeBack = () => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('stops the interval when the page is hidden and resumes with an immediate fetch', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
    renderHook(() => usePolled('/telemetry/summary', 1000));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    act(() => goHidden());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // Ten seconds in a pocket: not one request.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    act(() => comeBack());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // Visible again means fetch now - not "wait up to one interval showing
    // what the screen held when it was put away".
    expect(fetchMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not start polling at all if mounted while hidden', async () => {
    hidden = true;
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
    renderHook(() => usePolled('/telemetry/summary', 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => comeBack());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('unmount while hidden removes the listener - coming back later fetches nothing', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { ok: true })));
    const { unmount } = renderHook(() => usePolled('/telemetry/summary', 1000));
    act(() => goHidden());
    unmount();
    act(() => comeBack());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
