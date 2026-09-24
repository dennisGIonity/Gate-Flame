/* ========================================================================================
 * GATE^FLAME KIOSK - EVERY UNPROTECTED STATE MUST LOOK UNPROTECTED, ON EVERY SURFACE
 * Author: Dennis Grobler (Wabakipi) | Ionity Global (Pty) Ltd | AEDI
 * Governance: Policy 986 AED | (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2
 * ========================================================================================
 *
 * protectionStatus has FIVE values. Until 2026-09-21 the kiosk Overview knew three, so a
 * `degraded` box - GF-72TYTITQ's real 2026-08-24 failure, an empty gravity - rendered
 * "Reading protection state…" in grey on the wall, indefinitely. The lock screen had it
 * right; the panel behind it did not. This file renders the Overview once per state and
 * asserts what a customer would see. If a sixth state is ever added, the Record type in
 * panels.tsx fails to compile and this file's ALL_STATES list fails to type-check.
 * ======================================================================================== */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { FilteringState, ProtectionStatus } from '../../types/filtering';

vi.mock('./kioskClient', async (orig) => {
  const real = await orig<typeof import('./kioskClient')>();
  return {
    ...real,
    usePolled: () => ({ data: null, error: null, lastSeen: null, loading: false, refresh: () => {} }),
  };
});

import { OverviewPanel, PROTECTION_COPY, isFault } from './panels';

const ALL_STATES: readonly ProtectionStatus[] = ['active', 'paused', 'bypass', 'degraded', 'unconfigured'];

function filtering(status: ProtectionStatus, over: Partial<FilteringState> = {}): FilteringState {
  return {
    protectionStatus: status,
    enabled: status === 'active',
    pausedUntil: null,
    secondsRemaining: null,
    durationLabel: status === 'paused' ? 'Paused for 30 minutes' : null,
    reason: status === 'paused' ? 'kids homework' : null,
    threatLevel: { level: 'balanced', description: 'node text', blocklistCount: 3 },
    availableLevels: [],
    categories: [],
    pauseDurations: [],
    applying: false,
    lastError: status === 'degraded' ? 'Pi-hole has no blocklist loaded, so nothing is being blocked.' : null,
    ...over,
  } as FilteringState;
}

function renderOverview(f: FilteringState | null) {
  return render(<OverviewPanel telemetry={null} filtering={f} authority="console" active />);
}

describe('PROTECTION_COPY covers every ProtectionStatus', () => {
  it('has an entry for all five, and only active is green', () => {
    for (const s of ALL_STATES) {
      expect(PROTECTION_COPY[s], s).toBeDefined();
      expect(PROTECTION_COPY[s].title.length).toBeGreaterThan(0);
    }
    expect(PROTECTION_COPY.active.tone).toContain('10B981');
    for (const s of ALL_STATES.filter((x) => x !== 'active')) {
      expect(PROTECTION_COPY[s].tone, s).not.toContain('10B981');
    }
  });

  it('isFault names exactly the three box-failed states', () => {
    expect(ALL_STATES.filter(isFault)).toEqual(['bypass', 'degraded', 'unconfigured']);
    expect(isFault(null)).toBe(false);
  });
});

describe('OverviewPanel renders a verdict for every state - never the loading sentence', () => {
  for (const s of ALL_STATES) {
    it(`state=${s}`, () => {
      renderOverview(filtering(s));
      expect(screen.queryByText(/Reading protection state/)).toBeNull();
      expect(screen.getByText(PROTECTION_COPY[s].title)).toBeTruthy();
    });
  }

  it('still shows the loading sentence when there is genuinely no reading yet', () => {
    renderOverview(null);
    expect(screen.getByText(/Reading protection state/)).toBeTruthy();
  });
});

describe('the node explains its own faults, in its own words', () => {
  it('degraded shows lastError verbatim', () => {
    renderOverview(filtering('degraded'));
    expect(screen.getByText('Pi-hole has no blocklist loaded, so nothing is being blocked.')).toBeTruthy();
  });

  it('unconfigured with no lastError falls back to a sentence that still says NOT blocking', () => {
    renderOverview(filtering('unconfigured', { lastError: null }));
    expect(screen.getByText(/not blocking anything/i)).toBeTruthy();
  });

  it('active uses the approved copy and never the word safe', () => {
    renderOverview(filtering('active'));
    expect(screen.getByText('Your network is filtered')).toBeTruthy();
    expect(screen.getByText(/Malicious and unwanted domains are being blocked/)).toBeTruthy();
    expect(screen.queryByText(/safe/i)).toBeNull();
  });

  it('the owner’s pause reason is shown on paused and NOT on a fault', () => {
    renderOverview(filtering('paused'));
    expect(screen.getByText(/kids homework/)).toBeTruthy();
  });

  it('a fault never shows the pause reason (that field is the owner’s note, not a cause)', () => {
    renderOverview(filtering('degraded', { reason: 'kids homework' }));
    expect(screen.queryByText(/kids homework/)).toBeNull();
  });

  it('applying is visible on the overview, not only on the Filtering tab', () => {
    renderOverview(filtering('active', { applying: true }));
    expect(screen.getByText(/Applying — the blocklists are rebuilding/)).toBeTruthy();
  });
});
