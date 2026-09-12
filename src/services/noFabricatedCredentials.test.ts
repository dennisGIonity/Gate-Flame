/**
 * Gate^Flame — nothing in src/ may fabricate a credential.
 *
 * This test exists because of a specific defect that survived three audits and
 * one deliberate cleanup sweep.
 *
 * `ServerSyncArchitecture.tsx` had a refresh button wired to:
 *
 *   onUpdateUserAccount({ apiKey: `gf_live_ionity_${Math.random().toString(36).substring(2, 9)}` })
 *
 * rendered into a read-only field labelled "API Token". A random string wearing
 * a production-credential prefix, with no simulated marker anywhere near it.
 *
 * It was flagged on 2026-08-18, again twice on 2026-08-24, and it was still
 * there on 2026-09-12 — because the 2026-09-10 "remove every simulated data
 * path" sweep went after `mockData.ts` and `mockAdapter.ts` and never opened
 * this file. Prose in a status document does not stop a regression. A failing
 * test does.
 *
 * Why the rule is about the *destination* and not about randomness:
 * `Math.random()` is entirely legitimate in this tree. `LiveBackground`,
 * `GravityParticleCanvas` and `IonicrobesGame` use it for animation, and
 * `kiosk/charts.tsx` uses the identical `Math.random().toString(36)` idiom to
 * mint unique SVG gradient ids. None of those is a lie. What makes a lie is a
 * random value landing in a field the user reads as a credential — so that is
 * what is banned.
 *
 * Comments are stripped before scanning. The rule is about code, not about
 * writing down what went wrong — this very file, and the header of
 * `ServerSyncArchitecture.tsx`, would otherwise trip it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'src';

const SOURCE_EXT = /\.(ts|tsx|js|jsx)$/;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : SOURCE_EXT.test(full) ? [full] : [];
  });

/**
 * Remove block and line comments. Deliberately simple: a `//` inside a string
 * literal will truncate that line early, which can only ever cause a missed
 * detection on that one line, never a false failure. Given the alternative is
 * a TypeScript parser as a test dependency, that trade is the right way round.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Fields a reader will understand as a secret. */
const CREDENTIAL_FIELD = '(?:api_?key|api_?token|access_?token|auth_?token|token|secret|password|passphrase|credential)';

/** `apiKey: <anything up to the end of that value> Math.random(` */
const RANDOM_INTO_CREDENTIAL = new RegExp(
  `${CREDENTIAL_FIELD}\\s*[:=]\\s*[^,;\\n]*Math\\.random\\s*\\(`,
  'i',
);

/**
 * The exact prefix that shipped. Banned outright — it is not a real scheme.
 *
 * Assembled from fragments rather than written as a literal, because this test
 * twice failed on itself: first the regex spelled the prefix, then the failure
 * message did. A scanner that spells out the string it bans is its own first
 * offender — and the tempting fix is an exclusion for the scanner, which is
 * exactly how a guard quietly stops guarding. So the string exists here in
 * exactly one place, built at runtime, and everything else interpolates it.
 */
const FAKE_LIVE_PREFIX_TEXT = ['gf', 'live', ''].join('_');
const FAKE_LIVE_PREFIX = new RegExp(FAKE_LIVE_PREFIX_TEXT, 'i');

describe('no fabricated credentials in src/', () => {
  const files = walk(SRC).map((path) => ({ path, code: stripComments(readFileSync(path, 'utf8')) }));

  it('finds source files to scan', () => {
    // Guards against the whole suite silently passing because `walk` broke.
    expect(files.length).toBeGreaterThan(20);
  });

  it('never assigns a random value to a credential-shaped field', () => {
    const offenders = files
      .filter(({ code }) => RANDOM_INTO_CREDENTIAL.test(code))
      .map(({ path, code }) => {
        const line = code.split('\n').findIndex((l) => RANDOM_INTO_CREDENTIAL.test(l));
        return `${path}${line >= 0 ? `:${line + 1}` : ''}`;
      });

    expect(
      offenders,
      `A random value is being assigned to a field a user reads as a credential:\n` +
        offenders.map((o) => `  ${o}`).join('\n') +
        `\n\nA generated string that looks like a production key is worse than an ` +
        `empty field: the user cannot tell it is meaningless. Show the real ` +
        `credential, or show an honest gap.`,
    ).toEqual([]);
  });

  it(`never uses the ${FAKE_LIVE_PREFIX_TEXT} prefix`, () => {
    const offenders = files.filter(({ code }) => FAKE_LIVE_PREFIX.test(code)).map(({ path }) => path);

    expect(
      offenders,
      `The ${FAKE_LIVE_PREFIX_TEXT} prefix appears in:\n` +
        offenders.map((o) => `  ${o}`).join('\n') +
        `\n\nGate^Flame issues no such credential. Anything wearing this prefix ` +
        `is decoration impersonating a production key.`,
    ).toEqual([]);
  });
});
