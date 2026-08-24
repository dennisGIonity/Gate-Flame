/**
 * Gate^Flame mobile — bind the paired node into the shared console client.
 *
 * WHAT THIS IS FOR
 *
 * There are two working pieces that had never been introduced to each other:
 *
 *   - `services/` knows how to FIND a node and prove who we are. Discovery,
 *     pairing, the token, revocation handling. Tested, and it works.
 *   - `components/kiosk/kioskClient.ts` knows how to TALK to a node. Every
 *     endpoint, every response type, the polling loop, the formatters, and the
 *     honesty rules the console is built on.
 *
 * The old mobile app had a third thing - its own half-copy of the second - and
 * that copy drifted until the phone and the console disagreed about the same
 * network. This file removes the need for it: pairing supplies the address and
 * the token, kioskClient does the talking, and there is exactly one description
 * of what the node returns.
 *
 * Nothing here fetches. It only wires.
 */

import { getToken } from '../services/apiClient';
import { getConnection, subscribeConnection } from '../services/gateflameApi';
import { configureNodeTransport } from '../components/kiosk/kioskClient';

/**
 * Point the shared client at whatever node the pairing layer currently holds.
 *
 * Safe to call repeatedly. Driven by connection changes rather than done once
 * at startup, because the node's address can move underneath us - a new DHCP
 * lease, a re-pair, or the customer walking onto a different network - and a
 * client pinned to a stale address fails in the least helpful way possible:
 * silently, behind a spinner.
 */
export function syncNodeTransport(): void {
  const { nodeBaseUrl } = getConnection();
  if (!nodeBaseUrl) {
    // Unpaired, or discovery has not landed yet. Cleared rather than left
    // pointing at the last address: an unpaired app must not go on polling
    // someone's box.
    configureNodeTransport(null);
    return;
  }
  configureNodeTransport({
    baseUrl: nodeBaseUrl,
    // Read per request, never captured. A revoked token must stop being sent
    // the moment apiClient drops it, not at the next reconnect.
    authToken: getToken,
  });
}

/**
 * Keep the transport in step with the connection for the life of the app.
 * Returns an unsubscribe, though in practice this lives as long as the process.
 */
export function startNodeSession(): () => void {
  syncNodeTransport();
  return subscribeConnection(() => syncNodeTransport());
}
