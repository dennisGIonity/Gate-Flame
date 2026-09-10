/// <reference types="vite/client" />

/**
 * Typed environment for the Gate^Flame control app.
 *
 * Only VITE_-prefixed variables are exposed to the client by Vite. Nothing here
 * is a secret: everything in this interface ends up readable in the shipped
 * bundle. Node credentials are never build-time values — the device token is
 * issued at pairing and lives only in the handset.
 */
interface ImportMetaEnv {
  /**
   * Base URL of the Gate^Flame node, e.g. `http://192.168.1.105`.
   * Leave unset in production: the app discovers the node on the LAN.
   * Useful during development to point at a specific node.
   */
  readonly VITE_NODE_BASE_URL?: string;

  /**
   * Treat an unreachable node as a hard error instead of the 'offline' state.
   * `'true'` enables it. There is no simulated fallback in either case.
   */
  readonly VITE_STRICT_LIVE?: string;

  /** Request timeout in ms. Default 4000. */
  readonly VITE_API_TIMEOUT_MS?: string;

  /** Poll interval in ms for live telemetry. Default 4000. */
  readonly VITE_POLL_INTERVAL_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
