/**
 * @license
 * SPDX-License-Identifier: LicenseRef-AED-900
 * Ionity Global (Pty) Ltd — Gate^Flame brand & provenance metadata
 *
 * (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - All Rights Reserved - TM2
 * Governance: Policy 986 AED | Licence: AED 900 - see LICENSE at the repo root.
 * Non-commercial grant; commercial use requires written permission.
 */

/**
 * The ONE place identity, provenance and brand colour live in the app.
 *
 * Sourced from the canonical asset repository
 * (github.com/Ionity-Global-Pty-Ltd/ASSETS-IONITY-2026-) on 2026-09-10:
 * `brand/tokens/ionity-tokens.json` v1.1.0 and `brand/guidelines/BRAND-GUIDE.md`
 * DOC-2026-08-002. The token file itself is vendored beside the images in
 * `src/assets/brand/` so a build never reaches the network for a colour.
 *
 * Two people appear here, in two different roles, and the distinction is
 * deliberate (see CLAUDE.md, Rule Zero): Johan Wilhelm van Antwerp founded the
 * company and owns the brand; Dennis Grobler (Wabakipi) is the engineer who
 * builds and operates Gate^Flame. The document template names the founder;
 * the product names both.
 */

import tokens from '../assets/brand/ionity-tokens.json';

export const ORGANISATION = {
  legalName: 'Ionity (Pty) Ltd',
  tradingName: 'Ionity Global',
  formerName: 'Antwerp Designs',
  group: 'AEDI — Antwerp Ecosystems Designs Ionity',
  tagline: 'Building Tomorrow, Today.',
  motto: 'Anything is Possible with God.',
  location: 'Centurion, Gauteng, South Africa',
  web: 'https://www.ionity.today',
  profile: 'https://www.ionity.world',
  reference: 'https://www.ionity.co.za',
  shop: 'https://ionityearth.shop',
  email: 'info@ionity.today',
  phone: '+27 646 999 877',
  governance: 'Policy 986 AED',
  licence: 'AED 900 (hardware & software) | CC BY-NC-SA 4.0 where stated',
  rights: '(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd — All Rights Reserved — TM²',
  assetsRepo: 'https://github.com/Ionity-Global-Pty-Ltd/ASSETS-IONITY-2026-',
} as const;

export const PEOPLE = {
  founder: {
    name: 'Johan Wilhelm van Antwerp',
    roles: ['Founder', 'Technical Lead & Architect', 'Information Officer (POPIA)'],
    email: 'johan@ionity.today',
    orcid: '0009-0005-7181-0347',
  },
  engineer: {
    name: 'Dennis Grobler',
    alias: 'Wabakipi',
    roles: ['Gate^Flame Product Owner', 'Engineer & Operator'],
    email: 'dennis.g@ionity.today',
    github: 'dennisGIonity',
    organisation: 'Ionity Global',
  },
} as const;

export const PRODUCT = {
  name: 'Gate^Flame',
  nameAscii: 'Gate^Flame',
  strapline: 'Network security & privacy node',
  appId: 'today.ionity.gateflame',
  repo: 'https://github.com/dennisGIonity/Gate-Flame',
  privacyUrl: 'https://www.ionity.today/privacy',
} as const;

/** Colours, straight from the token file — never retyped. */
export const BRAND_COLOR = {
  purple: tokens.color.brand.purple.value,
  teal: tokens.color.brand.teal.value,
  cyan: tokens.color.brand.cyan.value,
  skyblue: tokens.color.brand.skyblue.value,
  themeColor: tokens.color.brand.c6ff.value,
  bg: tokens.color.surface.bg.value,
  bgLegacy: tokens.color['surface']['bg-legacy'].value,
  surface1: tokens.color.surface['surface-1'].value,
  border: tokens.color.surface.border.value,
  ink: tokens.color.surface.ink.value,
  text: tokens.color.text.default.value,
  textMuted: tokens.color.text.muted.value,
} as const;

export const BRAND_GRADIENT = tokens.gradient.brand.value;

export const BRAND_FONT = {
  sans: tokens.typography.family.sans.value,
  mono: tokens.typography.family.mono.value,
} as const;

/** Provenance line used on About screens, exports and document footers. */
export const provenanceLine = (): string =>
  `${ORGANISATION.rights} · ${ORGANISATION.governance} · ${ORGANISATION.tagline}`;

/** Byline naming both people in their roles. */
export const bylineLine = (): string =>
  `${PEOPLE.engineer.name} (${PEOPLE.engineer.alias}) · ${PEOPLE.founder.name} · ${ORGANISATION.tradingName}`;

export const BRAND_TOKENS_VERSION: string = tokens.meta.version;
