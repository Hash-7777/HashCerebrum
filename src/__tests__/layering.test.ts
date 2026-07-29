// Layering rules, enforced instead of documented.
//
// docs/ARCHITECTURE.md has always said that skipping a layer is a review
// rejection, but nothing checked it, so the only thing standing between the
// codebase and quiet erosion was whoever happened to read the diff. These three
// rules are the ones worth spending a test on:
//
//   1. Only the platform adapter calls invoke(). It is the single chokepoint
//      through which the renderer reaches Rust, and every guard, audit entry and
//      allowlist decision sits on the other side of it. A feature that calls
//      invoke() directly has stepped around all of it.
//   2. No feature imports another feature. Brain, Memory and Peer Review are
//      meant to be independent; when one reaches into another, a shared helper
//      has ended up living in the wrong place.
//   3. Core and config never import a feature. The dependency runs one way, and
//      a cycle here is the kind that survives review because it typechecks.
//
// Each rule failed at least once before this test existed.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function sourceFiles(dir: string, includeTests = false): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    if (entry === '__tests__' && !includeTests) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, includeTests));
    else if (/\.tsx?$/.test(entry) && (includeTests || !/\.test\.tsx?$/.test(entry))) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((f) => ({ path: relative(SRC, f), body: readFileSync(f, 'utf8') }));

/**
 * Modules that are unreachable from the app ON PURPOSE, because the test suite
 * is their only consumer — an eval-metric harness, a fixture builder.
 *
 * Kept deliberately tiny. Folding every test into the reachability graph was
 * tried and reverted: it made the check pass for scaffolding that has tests but
 * no caller, which is precisely the thing this check exists to catch. A suite
 * proves a module works; it never proves anything uses it.
 */
const TEST_ONLY_UTILITIES = new Set<string>([
  // Ranking-quality measures, so retrieval changes can be measured on a
  // labelled query set rather than guessed at. Imported by two test files.
  'core/rag/search/evalMetrics.ts',
]);

/** Every module specifier the file imports from, static or dynamic. */
function importsOf(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  return out;
}

/** The feature a path belongs to, or null. */
function featureOf(path: string): string | null {
  const m = /^features\/([^/]+)\//.exec(path);
  return m ? m[1]! : null;
}

/** The feature an import specifier points into, or null. */
function importedFeature(spec: string, fromPath: string): string | null {
  const alias = /^@features\/([^/]+)/.exec(spec);
  if (alias) return alias[1]!;
  if (!spec.startsWith('.')) return null;
  const dir = fromPath.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.') continue;
    else if (part === '..') dir.pop();
    else dir.push(part);
  }
  return featureOf(dir.join('/'));
}

/** Resolve an import specifier to a file path in the tree, or null if external. */
function resolveImport(spec: string, fromPath: string): string | null {
  let base: string;
  const ALIASES: Record<string, string> = {
    '@core': 'core', '@features': 'features', '@platform': 'platform',
    '@ui': 'ui', '@lib': 'lib', '@config': 'config', '@modes': 'modes', '@agents': 'agents',
  };
  const alias = Object.keys(ALIASES).find((a) => spec === a || spec.startsWith(`${a}/`));
  if (alias) base = spec.replace(alias, ALIASES[alias]!);
  else if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) {
    const dir = fromPath.split('/').slice(0, -1);
    for (const part of spec.split('/')) {
      if (part === '.') continue;
      else if (part === '..') dir.pop();
      else dir.push(part);
    }
    base = dir.join('/');
  } else return null; // node_modules

  const known = new Set(FILES.map((f) => f.path));
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (known.has(cand)) return cand;
  }
  return null;
}

/**
 * Modules that exist but no import path reaches, as of the layering sweep.
 *
 * This list is OUTSTANDING WORK, not an approved exception. Each entry is either
 * scaffolding that was never wired up or a feature that lost its last caller,
 * and each should be either connected or deleted. It exists so the check above
 * can hold the line at today's state: anything that becomes unreachable from
 * here on fails the suite immediately, instead of joining a pile nobody is
 * counting.
 *
 * The rule for this list is that it only ever shrinks.
 */
const KNOWN_UNREACHABLE = new Set<string>([
  // HIPAA Safe Harbor de-identification. Left in place deliberately rather than
  // deleted with the rest of the unwired modules: it is a compliance surface for
  // a medical app, and whether it should be wired into PDF import is a product
  // decision, not a cleanup one.
  'core/compliance/deidentify.ts',
]);

describe('layering', () => {
  it('finds the source tree', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  // The rule that keeps scaffolding from quietly accumulating. Four unfinished
  // modules — a collaboration layer, regulatory drafting, study-design forms —
  // once sat in the tree with passing tests and no caller at all, which is
  // precisely why nobody noticed them: a test suite proves a module works, never
  // that anything uses it.
  it('leaves no module unreachable from the entry point', () => {
    const byPath = new Map(FILES.map((f) => [f.path, f]));
    const entries = FILES.filter(
      (f) => f.path === 'main.tsx' || f.path.startsWith('workers/') || f.path.endsWith('.d.ts'),
    ).map((f) => f.path);

    const seen = new Set<string>(entries);
    const queue = [...entries];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const file = byPath.get(current);
      if (!file) continue;
      for (const spec of importsOf(file.body)) {
        const target = resolveImport(spec, current);
        if (target && !seen.has(target)) {
          seen.add(target);
          queue.push(target);
        }
      }
    }

    const unreachable = FILES.map((f) => f.path)
      .filter((p) => !seen.has(p))
      // Styles and asset modules are pulled in by CSS/bundler, not by an import
      // this walker can follow.
      .filter((p) => !p.startsWith('styles/') && !p.endsWith('.css'))
      .filter((p) => !TEST_ONLY_UTILITIES.has(p))
      .filter((p) => !KNOWN_UNREACHABLE.has(p));
    expect(unreachable).toEqual([]);
  });

  it('does not carry stale entries in the known-unreachable list', () => {
    // Once a module is wired up or deleted, its entry here must go too, or the
    // list quietly stops meaning anything.
    const paths = new Set(FILES.map((f) => f.path));
    expect([...KNOWN_UNREACHABLE].filter((p) => !paths.has(p))).toEqual([]);
  });

  it('routes every Tauri invoke() through the platform adapter', () => {
    const offenders = FILES.filter(
      (f) => !f.path.startsWith('platform/') && /\binvoke\s*(<[^>]*>)?\s*\(/.test(f.body),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('keeps features independent of one another', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const own = featureOf(file.path);
      if (!own) continue;
      for (const spec of importsOf(file.body)) {
        const target = importedFeature(spec, file.path);
        if (target && target !== own) offenders.push(`${file.path} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Value imports only, and the distinction is deliberate. A core module that
  // imports a feature's *type* is erased at compile time: it creates no runtime
  // edge, no cycle, and no bundle coupling. A core module that imports a
  // feature's *code* creates all three, and is the breach that can actually
  // break a build or deadlock a module graph.
  //
  // Six type-only edges remain (chat history and the export settings reaching
  // for a Manuscript, a GeneAssociation, a CitationStyle). They are a milder
  // smell worth cleaning up when those types find a shared home, but they are
  // not what this rule is defending against.
  it('never lets core or config import a feature at runtime', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      if (!file.path.startsWith('core/') && !file.path.startsWith('config/')) continue;
      for (const m of file.body.matchAll(/^import\s+(?!type\s)([^;]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
        const clause = m[1]!;
        const spec = m[2]!;
        if (!spec.startsWith('@features/') && !/(^|\/)features\//.test(spec)) continue;
        // `import { type X, type Y }` is also fully erased.
        const names = /^\{([^}]*)\}$/.exec(clause.trim());
        if (names && names[1]!.split(',').every((n) => !n.trim() || n.trim().startsWith('type '))) continue;
        offenders.push(`${file.path} -> ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
