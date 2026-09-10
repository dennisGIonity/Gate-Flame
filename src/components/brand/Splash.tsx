/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame startup splash
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 */

/**
 * The first thing every surface paints: the Gate^Flame mark drawing itself in
 * the brand gradient, the wordmark, the Ionity tagline. About 1.6 s, then it
 * fades and the real screen is underneath.
 *
 * Three rules, because a splash is the easiest place to be careless:
 *
 * 1. It is CSS-only. No `motion` import, no image request, no font wait. The
 *    wall panel boots after every load-shedding cut and must paint on the
 *    first frame; the phone must not download a library to show a logo.
 * 2. It respects reduced motion — both the OS setting
 *    (`prefers-reduced-motion`) and the box-side/local accessibility pref
 *    cached under `gateflame-a11y` — by showing the finished mark for 400 ms
 *    with no animation at all.
 * 3. It never blocks. `onDone` fires on a timer, not on an animation event,
 *    so a browser that drops the animation still hands over the screen.
 */

import { useEffect, useState } from 'react';
import { BRAND_COLOR, ORGANISATION, PRODUCT } from '../../config/brand';
import { GateFlameMark } from './GateFlameMark';

const FULL_MS = 1600;
const REDUCED_MS = 400;
const FADE_MS = 350;

export const A11Y_CACHE_KEY = 'gateflame-a11y';

/** Reduced motion if the OS says so OR the cached accessibility pref says so. */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return true;
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(A11Y_CACHE_KEY) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as { reducedMotion?: boolean };
      if (parsed.reducedMotion) return true;
    }
  } catch {
    /* storage or matchMedia unavailable: assume motion is fine */
  }
  return false;
}

export function Splash({ onDone, surface = 'app' }: { onDone: () => void; surface?: 'kiosk' | 'phone' | 'desktop' | 'app' }) {
  const reduced = prefersReducedMotion();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const show = reduced ? REDUCED_MS : FULL_MS;
    const t1 = window.setTimeout(() => setLeaving(true), show);
    const t2 = window.setTimeout(onDone, show + (reduced ? 0 : FADE_MS));
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [onDone, reduced]);

  return (
    <div
      role="status"
      aria-label={`${PRODUCT.name} is starting`}
      className={`gf-splash ${reduced ? 'gf-splash--static' : ''} ${leaving ? 'gf-splash--leaving' : ''}`}
      style={{ background: BRAND_COLOR.bg, color: BRAND_COLOR.text }}
      data-surface={surface}
    >
      <style>{SPLASH_CSS}</style>
      <div className="gf-splash__mark">
        <GateFlameMark size={surface === 'kiosk' ? 160 : 112} />
      </div>
      <div className="gf-splash__word">
        {PRODUCT.name.split('').map((ch, i) => (
          <span key={`${ch}-${i}`} style={{ animationDelay: `${0.55 + i * 0.045}s` }}>
            {ch}
          </span>
        ))}
      </div>
      <div className="gf-splash__tag">{ORGANISATION.tagline}</div>
      <div className="gf-splash__foot">
        {ORGANISATION.tradingName} · {ORGANISATION.governance}
      </div>
    </div>
  );
}

const SPLASH_CSS = `
.gf-splash{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
  font-family:${BRAND_COLOR ? "'Inter','Segoe UI',system-ui,-apple-system,sans-serif" : 'sans-serif'};
  opacity:1;transition:opacity ${FADE_MS}ms ease}
.gf-splash--leaving{opacity:0;pointer-events:none}
.gf-splash__mark{filter:drop-shadow(0 0 28px rgba(0,212,184,.35));animation:gf-pop .7s cubic-bezier(.2,.9,.3,1.2) both}
.gf-splash__mark svg path:first-of-type{stroke-dasharray:220;stroke-dashoffset:220;animation:gf-draw 1s .1s ease-out forwards}
.gf-splash__mark svg path:last-of-type{transform-origin:32px 40px;animation:gf-flame .9s .45s cubic-bezier(.2,.9,.3,1.2) both}
.gf-splash__word{display:flex;font-weight:700;letter-spacing:.06em;font-size:clamp(28px,4vw,44px);color:${BRAND_COLOR.text}}
.gf-splash__word span{display:inline-block;opacity:0;transform:translateY(10px);animation:gf-rise .45s ease-out forwards}
.gf-splash__tag{opacity:0;font-size:clamp(12px,1.4vw,16px);letter-spacing:.24em;text-transform:uppercase;color:${BRAND_COLOR.textMuted};
  animation:gf-fade .5s 1.05s ease-out forwards}
.gf-splash__foot{position:absolute;bottom:22px;opacity:0;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${BRAND_COLOR.textMuted};
  animation:gf-fade .5s 1.2s ease-out forwards}
.gf-splash--static *,.gf-splash--static .gf-splash__mark svg path{animation:none!important;opacity:1!important;transform:none!important;stroke-dashoffset:0!important}
.gf-splash--static{transition:none}
@keyframes gf-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes gf-draw{to{stroke-dashoffset:0}}
@keyframes gf-flame{from{transform:scale(.2) translateY(12px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}
@keyframes gf-rise{to{opacity:1;transform:translateY(0)}}
@keyframes gf-fade{to{opacity:1}}
@media (prefers-reduced-motion: reduce){.gf-splash *{animation:none!important;opacity:1!important;transform:none!important;stroke-dashoffset:0!important}}
`;

/**
 * Wraps a surface's root: shows the splash once per page load, then the
 * children. Nothing about the children waits for the splash — they mount
 * underneath and start polling immediately, so the ~1.6 s is not added to
 * time-to-data.
 */
export function WithSplash({ surface, children }: { surface: 'kiosk' | 'phone' | 'desktop'; children: React.ReactNode }) {
  const [done, setDone] = useState(false);
  return (
    <>
      {children}
      {!done && <Splash surface={surface} onDone={() => setDone(true)} />}
    </>
  );
}
