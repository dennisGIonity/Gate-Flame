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
   * Force simulated data regardless of whether a node is reachable.
   * `'true'` enables it. Used for sales demos and for UI work without hardware.
   * When unset, simulation is a *fallback* — the app tries the real node first.
   */
  readonly VITE_USE_MOCK_DATA?: string;

  /**
   * Never auto-fall back to simulation. `'true'` makes the app show connection
   * errors instead of demo data. Use in QA so a broken API cannot hide behind
   * plausible-looking numbers.
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
