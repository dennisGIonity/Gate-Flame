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

  const url = `${baseUrl}${config.apiPrefix}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Caller-supplied cancellation (component unmount) must also abort the fetch.
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener('abort', onExternalAbort);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous) {
    const token = readToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
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
