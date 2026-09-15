#!/usr/bin/env node
// Regenerates THIRDPARTY-LICENSES.md: every package in the two lockfiles, with
// the version pinned there and the licence it declares.
//
//   npm run licenses
//
// Sources:
// - Rust: `cargo metadata --locked` on src-tauri. It reads each crate's own
//   Cargo.toml, so it may download crates built only for other platforms the
//   first time; --locked means Cargo.lock is never changed.
// - npm: the `license` field package-lock.json records for each package.
//
// A package with no licence field stops the script unless it is listed in
// LICENSE_OVERRIDES below, so a new unknown licence cannot slip in silently.
// The output has no date, so re-running it on unchanged lockfiles changes
// nothing and every diff is a real dependency change.

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'THIRDPARTY-LICENSES.md');

// Packages whose manifest has no licence field, checked by hand. Keyed by
// name@version so an upgrade has to be checked again.
const LICENSE_OVERRIDES = {
  // package.json has no licence field; the package ships an MIT LICENSE file.
  'webgl-constants@1.1.1': 'MIT',
};

const usedOverrides = new Set();
const missing = [];

function licenseFor(name, version, declared) {
  if (declared) return declared;
  const key = `${name}@${version}`;
  if (key in LICENSE_OVERRIDES) {
    usedOverrides.add(key);
    return LICENSE_OVERRIDES[key];
  }
  missing.push(key);
  return 'Unknown';
}

function rustCrates() {
  const json = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(ROOT, 'src-tauri', 'Cargo.toml')],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  // A null source is a local path crate: HashCerebrum's own backend.
  return JSON.parse(json)
    .packages.filter((p) => p.source !== null)
    .map((p) => ({ name: p.name, version: p.version, license: licenseFor(p.name, p.version, p.license) }));
}

async function npmPackages() {
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
  const byKey = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue; // the root entry is HashCerebrum itself
    const name = entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const key = `${name}@${entry.version}`;
    const kind = entry.dev ? 'dev' : 'runtime';
    // The same name@version can be installed at several paths; it is one row,
    // and runtime wins if any copy of it is.
    const seen = byKey.get(key);
    if (seen) {
      if (kind === 'runtime') seen.kind = 'runtime';
      continue;
    }
    byKey.set(key, { name, version: entry.version, license: licenseFor(name, entry.version, entry.license), kind });
  }
  return [...byKey.values()];
}

// Numeric where both parts are numbers, so 0.10.0 sorts after 0.9.0.
function compareVersions(a, b) {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (x === y) continue;
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y);
    return x < y ? -1 : 1;
  }
  return 0;
}

// Plain code-point order, not locale order, so the output is the same on
// every machine.
function byNameThenVersion(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return compareVersions(a.version, b.version);
}

const cell = (text) => String(text).replace(/\|/g, '\\|');

function summaryRows(rust, npm) {
  const counts = new Map();
  for (const [list, column] of [[rust, 'rust'], [npm, 'npm']]) {
    for (const { license } of list) {
      const row = counts.get(license) ?? { license, rust: 0, npm: 0 };
      row[column] += 1;
      counts.set(license, row);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.rust + b.npm - (a.rust + a.npm) || (a.license < b.license ? -1 : 1))
    .map((r) => `| ${cell(r.license)} | ${r.rust} | ${r.npm} |`);
}

function render(rust, npm) {
  return `# Third-Party Licenses

This file lists all third-party dependencies used by HashCerebrum and their
respective licenses. HashCerebrum itself is licensed under the AGPL-3.0-or-later
(see \`LICENSE\`).

It is generated from \`src-tauri/Cargo.lock\` and \`package-lock.json\` by
\`npm run licenses\`. Do not edit it by hand: re-run the script after any
dependency change.

---

## Table of Contents

- [Rust Dependencies](#rust-dependencies)
- [NPM Dependencies](#npm-dependencies)
- [License Summary](#license-summary)
- [License Notices](#license-notices)

---

## Rust Dependencies

The following ${rust.length} Rust crates are used by the Tauri backend (\`src-tauri/\`).
Every crate in \`Cargo.lock\` is listed, including crates built only on other
platforms or only for tests.

| Crate | Version | License |
|-------|---------|---------|
${rust.map((c) => `| ${cell(c.name)} | ${cell(c.version)} | ${cell(c.license)} |`).join('\n')}

---

## NPM Dependencies

The following ${npm.length} JavaScript/TypeScript packages are used by the frontend.
Every package in \`package-lock.json\` is listed. Kind is \`runtime\` for the
app's dependencies and everything they pull in, and \`dev\` for tools used only
to build and test it.

| Package | Version | License | Kind |
|---------|---------|---------|------|
${npm.map((p) => `| ${cell(p.name)} | ${cell(p.version)} | ${cell(p.license)} | ${p.kind} |`).join('\n')}

---

## License Summary

How many packages declare each license expression, exactly as written in their
manifests. \`A OR B\` means the package may be used under either.

| License | Rust crates | NPM packages |
|---------|-------------|--------------|
${summaryRows(rust, npm).join('\n')}

---

## License Notices

### MIT License Notice

Several dependencies are licensed under the MIT License. The MIT License requires
that the following copyright notice be included:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

### Apache-2.0 License Notice

Several dependencies are licensed under the Apache License, Version 2.0. You may
obtain a copy of the Apache License at:

> https://www.apache.org/licenses/LICENSE-2.0

### BSD-2-Clause / BSD-3-Clause License Notice

Some dependencies use BSD-style licenses. These licenses require attribution in
documentation or source distributions.

### Other Licenses

Every other license in use is counted in the [License Summary](#license-summary).
\`docs/LICENSES.md\` records the license review: which licenses were checked by
hand and what each one requires.
`;
}

const rust = rustCrates().sort(byNameThenVersion);
const npm = (await npmPackages()).sort(byNameThenVersion);

if (missing.length > 0) {
  console.error(
    `No license field for: ${missing.join(', ')}.\n` +
      'Check each package by hand and add it to LICENSE_OVERRIDES in this script.',
  );
  process.exit(1);
}
const stale = Object.keys(LICENSE_OVERRIDES).filter((key) => !usedOverrides.has(key));
if (stale.length > 0) {
  console.error(`LICENSE_OVERRIDES entries no longer needed: ${stale.join(', ')}. Remove them.`);
  process.exit(1);
}

await writeFile(OUT, render(rust, npm));
console.log(`THIRDPARTY-LICENSES.md: ${rust.length} Rust crates, ${npm.length} npm packages.`);
