/**
 * Gate^Flame — find the node on the LAN.
 *
 * The customer never types an IP address if we can avoid it. Order:
 *   1. An explicitly configured VITE_NODE_BASE_URL, if set.
 *   2. A previously successful address, remembered across launches.
 *   3. The candidate list, probed concurrently — mDNS name first.
 *
 * Probes run in parallel and the first healthy answer wins, because probing
 * eight addresses at 4s each in series would take half a minute against a
 * network where none of them exists.
 */

import { config } from '../config/env';
import { apiRequest, ApiRequestError } from './apiClient';
import type { NodeStatusResponse } from '../types/api';

const LAST_KNOWN_KEY = 'gateflame-last-node-url';

const rememberNode = (baseUrl: string): void => {
  try {
    window.localStorage.setItem(LAST_KNOWN_KEY, baseUrl);
  } catch {
    /* ignore */
  }
};

const recallNode = (): string | null => {
  try {
    return window.localStorage.getItem(LAST_KNOWN_KEY);
  } catch {
    return null;
  }
};

export const forgetNode = (): void => {
  try {
    window.localStorage.removeItem(LAST_KNOWN_KEY);
  } catch {
    /* ignore */
  }
};

export interface DiscoveryResult {
  baseUrl: string;
  status: NodeStatusResponse;
}

/** A single health probe. Short timeout — this is a liveness check, not a fetch. */
const probe = async (baseUrl: string, signal?: AbortSignal): Promise<DiscoveryResult> => {
  const status = await apiRequest<NodeStatusResponse>(baseUrl, '/system/status', {
    timeoutMs: Math.min(config.apiTimeoutMs, 2500),
    signal,
  });

  // Guard against something else answering on that address. A captive portal or
  // an unrelated web server returning 200 must not be mistaken for a node.
  if (!status || typeof status.nodeId !== 'string' || typeof status.agentVersion !== 'string') {
    throw new ApiRequestError(`${baseUrl} answered, but is not a Gate^Flame node`, {
      isNetwork: true,
    });
  }

  return { baseUrl, status };
};

/**
 * Probe one operator-supplied address, and remember it if it answers.
 *
 * Exposed so the pairing screen can offer a manual address when discovery finds
 * nothing. The candidate list only covers the routers we ship against; a
 * customer on any other subnet would otherwise have no route at all to their own
 * appliance. Same identity guard as automatic discovery — something merely
 * returning 200 is not accepted as a node.
 */
export async function probeNodeAt(baseUrl: string, signal?: AbortSignal): Promise<DiscoveryResult> {
  const hit = await probe(baseUrl.trim().replace(/\/+$/, ''), signal);
  rememberNode(hit.baseUrl);
  return hit;
}

/**
 * Resolve a reachable node, or throw if none answers.
 *
 * Rejects only when *every* candidate fails, so the caller can treat a
 * rejection as "no node on this network" and fall back accordingly.
 */
export async function discoverNode(signal?: AbortSignal): Promise<DiscoveryResult> {
  // 1. Pinned by configuration — do not second-guess the operator.
  if (config.nodeBaseUrl) {
    return probe(config.nodeBaseUrl, signal);
  }

  // 2. Where we found it last time. Usually still correct, and it makes a
  //    relaunch on a known network instant rather than an 8-way race.
  const remembered = recallNode();
  if (remembered) {
    try {
      const hit = await probe(remembered, signal);
      return hit;
    } catch {
      // Node moved, or the phone is on a different network. Fall through.
    }
  }

  // 3. Race the candidates. Promise.any resolves on the first success and
  //    rejects only if all reject.
  const attempts = config.discoveryCandidates.map((url) => probe(url, signal));

  try {
    const hit = await Promise.any(attempts);
    rememberNode(hit.baseUrl);
    return hit;
  } catch {
    throw new ApiRequestError(
      'No Gate^Flame node found on this network. Check that the node is powered on and that this device is on the same Wi-Fi.',
      { isNetwork: true },
    );
  }
}
