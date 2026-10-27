#!/usr/bin/env node
// Regenerates THIRDPARTY-NOTICES.md: the attribution bundle a binary release
// has to carry — the actual copyright and permission text of every third-party
// package that ships inside the app, reproduced word for word.
//
//   npm run licenses
//
// THIRDPARTY-LICENSES.md is the inventory (what we depend on, under which
// licence). This file is the obligation (the notices themselves), so its scope
// is narrower on purpose: only what a user receives.
//
// - Rust: every crate in src-tauri/Cargo.lock. Crates for other platforms stay
//   in, because one notice file ships with every platform's build.
// - npm: only packages whose code or assets end up in the built frontend. That
//   is measured by running the real Vite build (including the worker builds)
//   and reading back which files it pulled in — so build tools, test tools and
//   optional native packages that never ship are left out. It also means this
//   file can change when app code changes, not only when a dependency does.
// - Bundled assets: the licence files vendored next to the fonts and models in
//   public/, which the build copies into the app.
//
// Identical notice text is printed once, with every package that ships it
// listed above it. Nothing is reworded, reflowed or summarised. Packages that
// publish no notice file at all are listed separately with what their manifest
// declares, so the gap is visible rather than hidden.
//
// The output has no date, so re-running it on an unchanged tree changes
// nothing and every diff is a real change in what the app ships.

import { writeFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { build } from 'vite';
import {
  byNameThenVersion,
  cargoPackages,
  fence,
  noticeFilesIn,
  npmLockPackages,
  readNotice,
  ROOT,
} from './license-sources.mjs';

const OUT = join(ROOT, 'THIRDPARTY-NOTICES.md');
const PUBLIC_DIR = join(ROOT, 'public');

/**
 * Package directories whose code or assets the production build includes.
 * Collected from the bundle itself: chunk module ids, and the original paths
 * of emitted assets (the WebAssembly runtime, the web fonts). Worker bundles
 * are built separately, so the collector is registered for those too.
 */
async function bundledPackageDirs() {
  const ids = new Set();
  const collector = () => ({
    name: 'license-notices:collect',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') for (const id of file.moduleIds) ids.add(id);
        else for (const name of file.originalFileNames ?? []) ids.add(name);
      }
    },
  });
  await build({
    logLevel: 'silent',
    plugins: [collector()],
    worker: { plugins: () => [collector()] },
    // Nothing is written to disk: this run only reports what the real build
    // would contain. public/ is skipped because its assets are handled below.
    build: { write: false, copyPublicDir: false },
  });

  const dirs = new Set();
  for (const id of ids) {
    // An id is absolute for a module and repo-relative for an emitted asset.
    const parts = relative(ROOT, resolve(ROOT, id.split('?')[0])).split('/');
    const last = parts.lastIndexOf('node_modules');
    if (last === -1) continue;
    // A scoped package is two path segments: @scope/name.
    const depth = parts[last + 1]?.startsWith('@') ? 2 : 1;
    dirs.add(parts.slice(0, last + 1 + depth).join('/'));
  }
  return dirs;
}

/**
 * How npm resolves `dep` for the package installed at `from`: the nearest
 * node_modules going up, which is where its code was loaded from.
 */
function resolveInstalled(lock, from, dep) {
  let at = from;
  for (;;) {
    const candidate = at ? `${at}/node_modules/${dep}` : `node_modules/${dep}`;
    if (lock.has(candidate)) return candidate;
    if (!at) return null;
    const up = at.lastIndexOf('/node_modules/');
    at = up === -1 ? '' : at.slice(0, up);
  }
}

/**
 * The packages in the build, plus the runtime dependencies those packages
 * declare, taken transitively.
 *
 * The declared dependencies are in because several packages publish a
 * self-contained build: docx carries a zip library inside its own file, and
 * the transformers package carries its template and tokenizer libraries the
 * same way. That code reaches a user with no module path of its own to find
 * it by, and the boundary cannot be read back out of a minified bundle — so
 * the list errs towards carrying a notice that is not needed rather than
 * dropping one that is.
 *
 * Left out: optional dependencies, which are the platform-native packages a
 * web build never includes, and `@types/*`, which is type declarations with
 * no code to ship.
 */
function bundledNpmPackages(dirs) {
  const lock = new Map(npmLockPackages().map((entry) => [entry.path, entry]));
  const paths = new Set(dirs);
  for (const path of paths) {
    const entry = lock.get(path);
    if (!entry) throw new Error(`${path} is in the build but not in package-lock.json`);
    for (const dep of Object.keys(entry.dependencies ?? {})) {
      if (dep.startsWith('@types/')) continue;
      const resolved = resolveInstalled(lock, path, dep);
      if (!resolved) continue;
      const installed = lock.get(resolved);
      if (!installed || installed.dev || installed.optional) continue;
      paths.add(resolved); // iterating a Set picks up what the loop adds
    }
  }
  return [...paths]
    .map((path) => ({ ...lock.get(path), dir: join(ROOT, path) }))
    .sort(byNameThenVersion);
}

/** Licence files vendored next to the bundled fonts and model weights. */
function bundledAssetNotices() {
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
    }
    for (const name of noticeFilesIn(dir)) found.push(join(dir, name));
  };
  walk(PUBLIC_DIR);
  return found.sort();
}

// Notice text grouped by its exact content, so the Apache-2.0 text is printed
// once rather than once per crate that ships a copy of it.
const groups = new Map();
function addNotice(text, label, fileName) {
  const group = groups.get(text) ?? { text, entries: [], files: new Set() };
  group.entries.push(label);
  group.files.add(fileName);
  groups.set(text, group);
}

const withoutNotice = [];

function collect(items) {
  for (const item of items) {
    const files = noticeFilesIn(item.dir);
    if (files.length === 0) {
      withoutNotice.push(item);
      continue;
    }
    for (const name of files) addNotice(readNotice(join(item.dir, name)), item.label, name);
  }
}

const cell = (text) => String(text).replace(/\|/g, '\\|');

function render() {
  const blocks = [...groups.values()]
    .map((group) => ({ ...group, entries: [...group.entries].sort(), fileNames: [...group.files].sort() }))
    .sort((a, b) => (a.entries[0] < b.entries[0] ? -1 : a.entries[0] > b.entries[0] ? 1 : 0));

  const body = blocks
    .map((group, index) => {
      const bar = fence(group.text);
      return [
        `### Notice ${index + 1} — ${group.fileNames.join(', ')}`,
        '',
        'Applies to:',
        '',
        ...group.entries.map((entry) => `- ${entry}`),
        '',
        bar + 'text',
        group.text,
        bar,
      ].join('\n');
    })
    .join('\n\n');

  const gaps = withoutNotice
    .sort((a, b) => (a.label < b.label ? -1 : 1))
    .map((item) => `| ${cell(item.label)} | ${cell(item.license ?? 'not declared')} | ${cell(item.authors || '—')} |`)
    .join('\n');

  return `# Third-Party Notices

This is the attribution bundle for a binary release of HashCerebrum: the
copyright and permission notices of the third-party packages that ship inside
the app, reproduced exactly as their authors published them. Permissive
licenses (MIT, BSD, Apache-2.0, OFL, Zlib) allow redistribution on the
condition that these notices travel with the binary, and Apache-2.0 also
requires that upstream \`NOTICE\` files be retained.

HashCerebrum's own license is the GNU AGPL-3.0-or-later; its full text is in
\`LICENSE\`, which ships beside this file. Nothing here changes that — these
notices cover other people's code.

It is generated by \`npm run licenses\` and must not be edited by hand.
[\`THIRDPARTY-LICENSES.md\`](THIRDPARTY-LICENSES.md) is the companion
inventory: every dependency in both lockfiles with its version and declared
license. This file is narrower on purpose — it carries only what a user
actually receives:

- **Rust:** every crate in \`src-tauri/Cargo.lock\`, including crates that only
  build on other platforms, because one notice file ships with every build.
- **npm:** the packages whose code or assets the production frontend build
  includes, together with the runtime dependencies those packages declare.
  The declared dependencies are in because a package can publish a
  self-contained build that carries a dependency's code inside its own file,
  where nothing in the output names it. Build and test tooling, optional
  native packages, and type-only packages are left out, so a name here is not
  by itself proof that the code reached the bundle.
- **Bundled assets:** the license files vendored next to the fonts and model
  weights in \`public/\`.

Identical notice text is printed once, with every package that ships it listed
above it. ${blocks.length} distinct notices cover ${blocks.reduce((n, g) => n + g.entries.length, 0)} package files.

---

## Packages that publish no notice file

These ${withoutNotice.length} packages ship no license, copyright or notice file of their own, so
there is no upstream text to reproduce for them. What their manifest declares
is recorded below, with the authors it names — the standard text of the license
each one names is the only text there is, and copies of the common ones appear
in the notices below for other packages that do ship a file.

| Package | Declared license | Authors |
|---------|------------------|---------|
${gaps}

---

## Notices

${body}
`;
}

const assetNotices = bundledAssetNotices();
collect(
  cargoPackages()
    .sort(byNameThenVersion)
    .map((p) => ({ ...p, label: `crate ${p.name} ${p.version}`, authors: p.authors.join(', ') })),
);
collect(
  bundledNpmPackages(await bundledPackageDirs()).map((p) => ({
    ...p,
    label: `npm ${p.name} ${p.version}`,
    authors: '',
  })),
);
for (const path of assetNotices) {
  addNotice(readNotice(path), `asset ${relative(ROOT, path)}`, relative(ROOT, path));
}

await writeFile(OUT, render());
console.log(
  `THIRDPARTY-NOTICES.md: ${groups.size} distinct notices, ${withoutNotice.length} packages publish none, ${assetNotices.length} bundled asset files.`,
);
