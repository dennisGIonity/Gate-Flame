/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame product mark
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

import React from 'react';
import { BRAND_COLOR } from '../../config/brand';
import ionityBadge from '../../assets/brand/ionity-badge-420.png';
import ionityAiMark from '../../assets/brand/ionity-ai-mark.png';
import ionityLogoDark from '../../assets/brand/ionity-logo-dark.png';
import aediLockup from '../../assets/brand/aedi-antwerp-designs-ionity-global.jpg';

/**
 * The Gate^Flame product mark: a gate (shield) holding a flame, drawn in the
 * Ionity brand gradient (purple → teal → cyan) from the token file.
 *
 * This is an inline SVG on purpose. It is the only mark that has to paint
 * before anything else — the splash, the favicon, the wall panel's first
 * frame — so it must not depend on an image request, a font, or the network.
 * The Ionity corporate marks (below) are real bitmaps from the asset repo and
 * are used where a bitmap is appropriate: About screens, exports, splash
 * footers.
 */
export const GateFlameMark: React.FC<{ size?: number; className?: string; title?: string }> = ({
  size = 48,
  className,
  title = 'Gate^Flame',
}) => {
  const id = React.useId();
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={BRAND_COLOR.purple} />
          <stop offset="0.5" stopColor={BRAND_COLOR.teal} />
          <stop offset="1" stopColor={BRAND_COLOR.cyan} />
        </linearGradient>
      </defs>
      <path
        d="M32 3 8 12v18c0 15 10 26 24 31 14-5 24-16 24-31V12z"
        fill={BRAND_COLOR.bg}
        stroke={`url(#${id})`}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M32 16c6 7 9 12 9 18a9 9 0 0 1-18 0c0-3 1-5 3-7 0 3 1 5 3 6-1-6 0-11 3-17z"
        fill={`url(#${id})`}
      />
    </svg>
  );
};

/** Ionity Global square badge (420 px, from brand/logos). */
export const IonityBadge: React.FC<{ size?: number; className?: string }> = ({ size = 40, className }) => (
  <img
    src={ionityBadge}
    width={size}
    height={size}
    alt="Ionity Global"
    className={className}
    draggable={false}
  />
);

/** Ionity AI mark (512 px, transparent) for AI / anomaly-detection surfaces. */
export const IonityAiMark: React.FC<{ size?: number; className?: string }> = ({ size = 40, className }) => (
  <img src={ionityAiMark} width={size} height={size} alt="Ionity AI" className={className} draggable={false} />
);

/** Ionity Global horizontal logo, dark variant, for light surfaces and print. */
export const IonityLogoDark: React.FC<{ height?: number; className?: string }> = ({ height = 32, className }) => (
  <img src={ionityLogoDark} height={height} alt="Ionity Global" className={className} draggable={false} />
);

/** AEDI · Antwerp Designs · Ionity Global lockup for About and provenance panels. */
export const AediLockup: React.FC<{ height?: number; className?: string }> = ({ height = 48, className }) => (
  <img
    src={aediLockup}
    height={height}
    alt="AEDI — Antwerp Designs — Ionity Global"
    className={className}
    draggable={false}
  />
);
