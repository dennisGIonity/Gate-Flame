/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The gravity field's legend must show the reading it was given, or a dash.
 *
 * WHY THIS TEST EXISTS
 *
 * Until 2026-08-25 that legend read `Blocked (37.1%)` — a literal, baked into
 * the JSX. It sat on the phone's home screen directly beneath the real block
 * share and contradicted it: the screenshot that caught it showed 7% in the
 * ring and 37.1% in the caption, on the same screen, at the same moment.
 *
 * The particles had always been driven by the real prop. Only the caption was
 * invented, which is the worst possible split — the picture was honest and the
 * number beside it was not, so a customer had no way to tell which to trust.
 *
 * It survived a full rebuild of the mobile app, a design-system pass, an audit
 * that produced four documents, and a hundred and seventy-eight passing tests,
 * because nothing rendered this component and looked at the output. So this
 * file does exactly that, and nothing else.
 */

import { describe, expect, it, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

import { GravityParticleCanvas } from './GravityParticleCanvas';

// jsdom has no canvas backend. The component's simulation is not under test
// here — only what it PRINTS — so a stub context is enough to let it mount.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () =>
      new Proxy(
        {},
        {
          get: (_t, prop) =>
            prop === 'canvas' ? document.createElement('canvas') : () => undefined,
        },
      ),
  ) as unknown as HTMLCanvasElement['getContext'];

  // The component observes visibility to park its animation loop.
  if (!('IntersectionObserver' in globalThis)) {
    class IO {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      readonly root = null;
      readonly rootMargin = '';
      readonly thresholds: number[] = [];
    }
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
  }
});

describe('GravityParticleCanvas legend', () => {
  it('prints the block share it was given', () => {
    render(<GravityParticleCanvas isPaused={false} threatFeed={[]} blockPercentage={7.2} />);
    expect(screen.getByText(/Blocked \(7\.2%\)/)).toBeTruthy();
  });

  it('prints a dash rather than a number when there is no reading', () => {
    render(<GravityParticleCanvas isPaused threatFeed={[]} blockPercentage={null} />);
    expect(screen.getByText(/Blocked \(—\)/)).toBeTruthy();
  });

  it('never prints the figure that used to be hardcoded', () => {
    // Deliberately passes a DIFFERENT value. If the literal ever comes back,
    // this fails whatever the caller supplied — which is the only way to catch
    // a constant that ignores its input.
    const { container } = render(
      <GravityParticleCanvas isPaused={false} threatFeed={[]} blockPercentage={12.5} />,
    );
    expect(container.textContent).not.toContain('37.1%');
    expect(container.textContent).toContain('12.5%');
  });

  it('does not turn a missing reading into zero', () => {
    const { container } = render(
      <GravityParticleCanvas isPaused threatFeed={[]} blockPercentage={null} />,
    );
    expect(container.textContent).not.toContain('0.0%');
  });
});
