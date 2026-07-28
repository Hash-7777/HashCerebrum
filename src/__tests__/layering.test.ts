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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((f) => ({ path: relative(SRC, f), body: readFileSync(f, 'utf8') }));

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

describe('layering', () => {
  it('finds the source tree', () => {
    expect(FILES.length).toBeGreaterThan(200);
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
