// Where the two licence files get their facts. Shared by
// generate-third-party-licenses.mjs (the inventory) and
// generate-license-notices.mjs (the notice bundle) so the two can never
// disagree about which packages the project depends on.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every crate in src-tauri/Cargo.lock, with the directory Cargo unpacked it
 * into. `cargo metadata` reads each crate's own Cargo.toml, so the first run
 * may download crates that only build on other platforms; --locked means
 * Cargo.lock is never changed.
 */
export function cargoPackages() {
  const json = execFileSync(
    'cargo',
    ['metadata', '--format-version', '1', '--locked', '--manifest-path', join(ROOT, 'src-tauri', 'Cargo.toml')],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  // A null source is a local path crate: HashCerebrum's own backend.
  return JSON.parse(json)
    .packages.filter((p) => p.source !== null)
    .map((p) => ({
      name: p.name,
      version: p.version,
      license: p.license,
      authors: p.authors ?? [],
      repository: p.repository ?? null,
      dir: dirname(p.manifest_path),
    }));
}

/** Every entry in package-lock.json, keyed by its install path. */
export function npmLockPackages() {
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
  return Object.entries(lock.packages)
    .filter(([path]) => path !== '') // the root entry is HashCerebrum itself
    .map(([path, entry]) => ({
      path,
      name: entry.name ?? path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: entry.version,
      license: entry.license,
      dev: !!entry.dev,
      // npm installs an optional dependency only where its platform matches,
      // so these are the native packages a web build never carries.
      optional: !!entry.optional,
      /** Declared runtime dependencies, by name. */
      dependencies: entry.dependencies ?? {},
    }));
}

// Numeric where both parts are numbers, so 0.10.0 sorts after 0.9.0.
export function compareVersions(a, b) {
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
export function byNameThenVersion(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return compareVersions(a.version, b.version);
}

// The file names upstream projects use for the text a redistributor has to
// carry: the licence itself, and Apache-2.0's NOTICE.
const NOTICE_FILE = /^(licen[cs]e|copying|notice|copyright|unlicen[cs]e|patents)([-._ ].*)?$/i;
// A licence-shaped name that is code or machine-readable config, not a notice.
// `.spdx` is deliberately NOT here: the Tauri packages ship their copyright
// line in one, and dropping it would drop the attribution they ask for.
const NOT_A_NOTICE = /\.(json|ya?ml|toml|js|mjs|cjs|ts)$/i;

/** Licence and NOTICE file names in a package directory, sorted. */
export function noticeFilesIn(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => NOTICE_FILE.test(name) && !NOT_A_NOTICE.test(name))
    .filter((name) => {
      try {
        return statSync(join(dir, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * A notice file as text. Most are UTF-8; a few older ones are Latin-1, which
 * decodes to U+FFFD as UTF-8 and would put a replacement character into
 * someone's copyright line.
 */
export function readNotice(path) {
  const bytes = readFileSync(path);
  const utf8 = bytes.toString('utf8');
  const text = utf8.includes('�') ? bytes.toString('latin1') : utf8;
  return text.replace(/\r\n/g, '\n').trim();
}

/**
 * A markdown fence long enough to hold the given text: a notice that contains
 * its own backtick run would otherwise close the block early and the rest of
 * someone's copyright text would be read as markdown.
 */
export function fence(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}
