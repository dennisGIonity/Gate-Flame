/**
 * Gate^Flame — there must be no import cycles in src/.
 *
 * This test exists because of a specific failure, not as hygiene theatre.
 *
 * On 2026-08-18 the mobile APK painted and then died on a real handset with:
 *
 *   Uncaught ReferenceError: Cannot access 'je' before initialization
 *       at assets/mobile.<hash>.js
 *
 * The cause was a three-module cycle:
 *
 *   gateflameApi → mockAdapter → serviceManager → gateflameApi
 *
 * mockAdapter read `SECURITY_MODULES` from serviceManager at module-evaluation
 * time (building `simulatedModules` as a top-level const). In a cycle, one
 * side is necessarily evaluated while the other is still initialising, so the
 * binding is in its temporal dead zone. Whether it threw depended purely on
 * which module the bundler evaluated first — which is to say it was luck, and
 * the luck ran out when a manualChunks vendor split changed the order.
 *
 * Why a test rather than a lint rule: this is cheap, has no new dependency,
 * runs in the existing suite, and — most importantly — prints the actual cycle
 * path, which is the only thing anyone needs in order to fix it. A minified
 * TDZ error on a phone gives you none of that, and cost most of an afternoon.
 *
 * A cycle is not always fatal. It is fatal exactly when a module in the cycle
 * touches an imported binding during evaluation, and that is not something a
 * reviewer can reliably eyeball. So the rule here is zero cycles, not "no
 * dangerous cycles".
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = 'src';

/** `import ... from '...'` and `export ... from '...'`, static only. */
const IMPORT_RE = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm;

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    if (!/\.tsx?$/.test(name)) return [];
    // Tests may legitimately import anything; they are not shipped.
    if (/\.(test|spec)\.tsx?$/.test(name)) return [];
    return [full];
  });

/** Resolve a relative specifier to a real file, mirroring Vite's resolution. */
const resolveLocal = (from: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null; // bare specifier — node_modules
  const base = normalize(join(dirname(from), spec));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not this one
    }
  }
  return null;
};

const buildGraph = (): Map<string, string[]> => {
  const graph = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const source = readFileSync(file, 'utf8');
    const edges: string[] = [];
    for (const match of source.matchAll(IMPORT_RE)) {
      const target = resolveLocal(file, match[1]);
      if (target) edges.push(target);
    }
    graph.set(file, edges);
  }
  return graph;
};

/** Every distinct cycle, as a readable path. */
const findCycles = (graph: Map<string, string[]>): string[][] => {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const finished = new Set<string>();

  const visit = (node: string, stack: string[], onStack: Set<string>): void => {
    for (const next of graph.get(node) ?? []) {
      if (onStack.has(next)) {
        const cycle = [...stack.slice(stack.indexOf(next)), next];
        // Dedup on the SET of participating modules, not the path. A→B→C→A and
        // B→C→A→B are one cycle reported from two entry points; keying on the
        // path (even sorted) counts each rotation separately and prints the
        // same problem three times.
        const key = [...new Set(cycle)].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push(cycle);
        }
      } else if (!finished.has(next)) {
        visit(next, [...stack, next], new Set(onStack).add(next));
      }
    }
  };

  for (const node of [...graph.keys()].sort()) {
    visit(node, [node], new Set([node]));
    finished.add(node);
  }
  return cycles;
};

describe('module graph', () => {
  it('has no import cycles', () => {
    const cycles = findCycles(buildGraph());
    const rendered = cycles
      .map((c) => c.map((f) => f.replace(/^src[/\\]/, '')).join(' → '))
      .join('\n  ');

    expect(
      cycles,
      cycles.length
        ? `Import cycle(s) found in src/. A cycle makes module evaluation order ` +
          `decide whether a top-level binding exists yet, which surfaces as ` +
          `"Cannot access 'x' before initialization" — in a minified bundle, on a ` +
          `device, with no useful stack. Break the cycle by moving the shared data ` +
          `into a leaf module (see src/services/securityModules.ts).\n\n  ${rendered}\n`
        : '',
    ).toEqual([]);
  });

  it('keeps the security-module catalogue a leaf', () => {
    // The specific regression: if securityModules.ts ever imports from the
    // project again, the old cycle can reform through it.
    const source = readFileSync(join(SRC, 'services', 'securityModules.ts'), 'utf8');
    const local = [...source.matchAll(IMPORT_RE)]
      .map((m) => m[1])
      .filter((s) => s.startsWith('.'));
    expect(local, 'securityModules.ts must not import from the project').toEqual([]);
  });
});
