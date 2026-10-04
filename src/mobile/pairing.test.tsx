/* ========================================================================================
 * GATE^FLAME MOBILE - PAIRING ON ANY SUBNET (B5)
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * Discovery probes two mDNS names and a fixed list of common addresses. A box on any
 * other subnet (the lab is 192.168.124.x) is found only if `.local` resolves on that
 * handset - and until 2026-10-03 the address box appeared only after the whole race had
 * FAILED. It is now on screen from the first frame, with one line saying where the
 * address is. The fix is the phone accepting the address the box shows, not a longer
 * list of guessed addresses, so the candidate list is untouched.
 * ======================================================================================== */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// A discovery race that never finishes: the screen stays on its very first frame,
// which is exactly when the owner needs the address box.
vi.mock('../services/nodeDiscovery', () => ({
  discoverNode: () => new Promise(() => {}),
  probeNodeAt: () => new Promise(() => {}),
  forgetNode: () => {},
}));

import { AppPairingScreen } from '../components/AppPairingScreen';

describe('AppPairingScreen: the address box is there from the first frame', () => {
  it('offers manual entry while discovery is still running, with where to find the address', () => {
    render(<AppPairingScreen />);
    expect(screen.getByRole('status').textContent).toMatch(/Looking for a Gate\^Flame node/);
    const input = screen.getByLabelText(/Know the node.s address\? Enter it here\./);
    expect(input.tagName).toBe('INPUT');
    expect(screen.getByText('The address is shown on your Gate^Flame screen.')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toContain('gf-manual-address-where');
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('keeps every string it had', () => {
    render(<AppPairingScreen />);
    expect(screen.getByText('Connect to your Gate^Flame node')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Search again' })).toBeTruthy();
    expect(screen.getByText('Port 8080 is assumed unless you type a different one.')).toBeTruthy();
    expect(screen.getByPlaceholderText('192.168.4.20')).toBeTruthy();
  });
});
