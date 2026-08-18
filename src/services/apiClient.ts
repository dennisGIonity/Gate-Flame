/**
 * Gate^Flame — HTTP client for the node API.
 *
 * Replaces the commented-out `fetch` that sat in serviceManager.ts. Real
 * requests, real timeouts, real errors — no `setTimeout(800); return true`.
 *
 * Deliberate properties:
 *  - Every request has a timeout. A node that is powered off must fail in
 *    `apiTimeoutMs`, not hang the UI until the browser gives up.
 *  - Errors are typed and carry the HTTP status, so the caller can tell
 *    "no node here" from "node said no".
 *  - The device token is read from storage per-request rather than captured at
 *    module load, so pairing takes effect without a reload.
 */

import { config } from '../config/env';
import type { ApiError } from '../types/api';

export class ApiRequestError extends Error {
  readonly status: number;
  readonly body: ApiError | null;
  readonly isTimeout: boolean;
  readonly isNetwork: boolean;

  constructor(
    message: string,
    opts: { status?: number; body?: ApiError | null; isTimeout?: boolean; isNetwork?: boolean } = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = opts.status ?? 0;
    this.body = opts.body ?? null;
    this.isTimeout = opts.isTimeout ?? false;
    this.isNetwork = opts.isNetwork ?? false;
  }

  /** True when nothing answered — as opposed to something answering with an error. */
  get isUnreachable(): boolean {
    return this.isTimeout || this.isNetwork;
  }
}

const readToken = (): string | null => {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(config.tokenStorageKey);
  } catch {
    return null;
  }
};

export const storeToken = (token: string): void => {
  try {
    window.localStorage.setItem(config.tokenStorageKey, token);
  } catch {
    /* storage blocked — the session simply will not survive a reload */
  }
};

export const clearToken = (): void => {
  try {
    window.localStorage.removeItem(config.tokenStorageKey);
  } catch {
    /* ignore */
  }
};

export const hasToken = (): boolean => readToken() !== null;

/**
 * Notified when the node REJECTS a token we actually sent (an authenticated
 * 401). The token is cleared before listeners run, so `hasToken()` is already
 * false by the time anyone reacts.
 *
 * Why this exists: the owner can revoke a handset from the kiosk — that is a
 * headline feature of the pairing contract, and the point of it is a lost or
 * stolen phone. Before this, a revoked phone kept its dead token forever:
 * `main-mobile` read `hasToken()` once at mount, so the dashboard stayed up,
 * polled every 4s, logged `401` to a console nobody can see, and offered the
 * user no route back to pairing. Revocation worked on the node and was
 * invisible on the device.
 *
 * Deliberately narrow — a 401 only counts when a token was attached to that
 * request. `pair/claim` answers 401 for a wrong code, and treating that as
 * "your token is dead" would wipe a good token every time someone fat-fingers
 * a digit while pairing a second handset.
 */
type TokenRejectedListener = () => void;
const tokenRejectedListeners = new Set<TokenRejectedListener>();

export const onTokenRejected = (listener: TokenRejectedListener): (() => void) => {
  tokenRejectedListeners.add(listener);
  return () => {
    tokenRejectedListeners.delete(listener);
  };
};

const notifyTokenRejected = (): void => {
  // Snapshot: a listener may unsubscribe itself while we iterate.
  for (const listener of [...tokenRejectedListeners]) {
    try {
      listener();
    } catch {
      /* a broken listener must not break the request path */
    }
  }
};

/**
 * Refuse cleartext to anything that is not the customer's own LAN.
 *
 * This lives here rather than in android/app/src/main/res/xml/
 * network_security_config.xml because Android's `<domain>` rule matches
 * hostnames, not CIDR ranges — it cannot express "RFC1918 only", and the
 * version that tried to instead blocked every request to a node by IP. See the
 * note at the top of that file.
 *
 * So the manifest permits cleartext and this does the narrowing, on every
 * request, in the one place all of them pass through. HTTPS is always allowed:
 * the restriction is about sending a bearer token in the clear, not about
 * where the app may talk.
 */
export function assertPrivateHost(baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new ApiRequestError(`"${baseUrl}" is not a valid address.`, { isNetwork: true });
  }

  if (url.protocol === 'https:') return;
  if (url.protocol !== 'http:') {
    throw new ApiRequestError(`Refusing to use ${url.protocol} — only http and https are supported.`, {
      isNetwork: true,
    });
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  // Loopback, and mDNS names, which only resolve on the local link.
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return;

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])];
    if (octets.some((n) => n > 255)) {
      throw new ApiRequestError(`"${host}" is not a valid IP address.`, { isNetwork: true });
    }
    const [a, b] = octets;
    if (a === 127) return; // 127.0.0.0/8    loopback
    if (a === 10) return; // 10.0.0.0/8     RFC1918
    if (a === 192 && b === 168) return; // 192.168.0.0/16 RFC1918
    if (a === 172 && b >= 16 && b <= 31) return; // 172.16.0.0/12  RFC1918
    if (a === 169 && b === 254) return; // 169.254.0.0/16 RFC3927 link-local
  }

  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return;

  throw new ApiRequestError(
    `Refusing to send an unencrypted request to ${host} — a Gate^Flame node is only ever reached on your own network.`,
    { isNetwork: true },
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
  timeoutMs?: number;
  /** Suppress the Authorization header — used by the pairing claim endpoint. */
  anonymous?: boolean;
  signal?: AbortSignal;
}

/**
 * Perform a request against a node.
 *
 * `baseUrl` is explicit rather than global because discovery probes several
 * candidate addresses concurrently before any of them is "the" node.
 */
export async function apiRequest<T>(
  baseUrl: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    body,
    timeoutMs = config.apiTimeoutMs,
    anonymous = false,
    signal,
  } = options;

  // Throws before any socket is opened, so a token can never leave the device
  // towards a host outside the customer's own network.
  assertPrivateHost(baseUrl);

  const url = `${baseUrl}${config.apiPrefix}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Caller-supplied cancellation (component unmount) must also abort the fetch.
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Tracked so an authenticated 401 can be told apart from a 401 on a request
  // that carried no credentials at all (pair/claim with a wrong code).
  let tokenWasSent = false;
  if (!anonymous) {
    const token = readToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      tokenWasSent = true;
    }
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      // The node is on the LAN and issues bearer tokens; it does not use
      // cookies, so credentials must not ride along.
      credentials: 'omit',
      cache: 'no-store',
    });

    if (!response.ok) {
      let parsed: ApiError | null = null;
      try {
        parsed = (await response.json()) as ApiError;
      } catch {
        /* non-JSON error body */
      }

      // The node says the token we sent is no good — it was revoked at the
      // kiosk, or the node was factory reset. Drop it and say so, so the UI
      // can return to pairing instead of retrying a dead credential forever.
      // Only when we actually sent one: a 401 from pair/claim means "wrong
      // code", not "your token is dead".
      if (response.status === 401 && tokenWasSent) {
        clearToken();
        notifyTokenRejected();
      }

      throw new ApiRequestError(
        parsed?.message ?? parsed?.error ?? `${method} ${path} failed with ${response.status}`,
        { status: response.status, body: parsed },
      );
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof ApiRequestError) throw err;

    if (err instanceof DOMException && err.name === 'AbortError') {
      // Distinguish "we gave up" from "the caller cancelled".
      if (signal?.aborted) {
        throw new ApiRequestError('Request cancelled', { isNetwork: true });
      }
      throw new ApiRequestError(`No response from ${baseUrl} within ${timeoutMs}ms`, {
        isTimeout: true,
      });
    }

    throw new ApiRequestError(
      err instanceof Error ? err.message : `Could not reach ${baseUrl}`,
      { isNetwork: true },
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
