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

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * B4, 2026-10-03 (Dennis's call): the caption "GRAVITY™ EDGE AI THREAT
 * INTERCEPTOR" is gone. The box is a DNS blocklist filter; that sentence was a
 * claim it cannot back, on the phone's Home screen, beside a dot that pinged
 * forever. The legend with the real figure stays.
 */
describe('GravityParticleCanvas caption', () => {
  it('makes no "AI threat interceptor" claim, and keeps the real legend', () => {
    const { container } = render(
      <GravityParticleCanvas isPaused={false} threatFeed={[]} blockPercentage={7.2} />,
    );
    expect(container.textContent).not.toMatch(/INTERCEPTOR|EDGE AI|™/i);
    expect(container.querySelector('.animate-ping')).toBeNull();
    expect(screen.getByText(/Blocked \(7\.2%\)/)).toBeTruthy();
  });
});

/**
 * Found while checking the core label for B4: every stopped field said PAUSED,
 * so a box in bypass/degraded/unconfigured - or one the phone could not reach -
 * carried the word for the OWNER'S choice under a hero reading "Not filtering"
 * or "Cannot see your box". Only the owner's own pause is named now.
 */
describe('GravityParticleCanvas core word', () => {
  let saved: HTMLCanvasElement['getContext'];
  let drawn: string[] = [];

  beforeEach(() => {
    drawn = [];
    saved = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        new Proxy(
          {},
          {
            get: (_t, prop) =>
              prop === 'fillText'
                ? (text: string) => {
                    drawn.push(text);
                  }
                : prop === 'canvas'
                  ? document.createElement('canvas')
                  : () => undefined,
          },
        ),
    ) as unknown as HTMLCanvasElement['getContext'];
    // Reduced motion draws the single still frame synchronously, inside the
    // effect - no animation loop to wait for.
    document.documentElement.classList.add('reduce-motion');
  });

  afterEach(() => {
    document.documentElement.classList.remove('reduce-motion');
    HTMLCanvasElement.prototype.getContext = saved;
  });

  it('a running field names its core GRAVITY', () => {
    render(<GravityParticleCanvas isPaused={false} threatFeed={[]} blockPercentage={7.2} />);
    expect(drawn).toContain('GRAVITY');
    expect(drawn).not.toContain('PAUSED');
  });

  it('the owner’s pause is PAUSED - and so is a caller that does not say why (the old meaning)', () => {
    render(<GravityParticleCanvas isPaused stoppedBy="owner" threatFeed={[]} blockPercentage={null} />);
    expect(drawn).toContain('PAUSED');
    drawn = [];
    render(<GravityParticleCanvas isPaused threatFeed={[]} blockPercentage={null} />);
    expect(drawn).toContain('PAUSED');
  });

  for (const why of ['fault', 'unknown'] as const) {
    it(`stopped by ${why}: no PAUSED, and no GRAVITY either`, () => {
      render(<GravityParticleCanvas isPaused stoppedBy={why} threatFeed={[]} blockPercentage={null} />);
      expect(drawn).not.toContain('PAUSED');
      expect(drawn).not.toContain('GRAVITY');
    });
  }
});
