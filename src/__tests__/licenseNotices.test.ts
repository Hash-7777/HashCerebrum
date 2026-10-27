// The helpers that decide what goes into the notice bundle.
//
// THIRDPARTY-NOTICES.md is the file a binary release carries to satisfy the
// attribution conditions of every permissive licence in the tree, so the two
// ways it can quietly go wrong are worth a test: a notice file that is not
// recognised (the package silently loses its attribution), and text that is
// altered on the way in — mojibake from a Latin-1 file, or a notice that
// escapes its markdown block and takes the rest of the file with it.
//
// The generator itself is not run here: it needs `cargo metadata` and a full
// Vite build. `npm run licenses` is the release step that exercises it.

import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fence, noticeFilesIn, readNotice } from '../../scripts/license-sources.mjs';

const roots: string[] = [];

function dirWith(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hc-notices-'));
  roots.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});

describe('noticeFilesIn', () => {
  it('finds the names upstream projects actually use, in a stable order', () => {
    const dir = dirWith({
      LICENSE: 'a',
      'LICENSE-APACHE': 'b',
      'LICENSE-MIT': 'c',
      COPYING: 'd',
      NOTICE: 'e',
      'copyright.txt': 'f',
      UNLICENCE: 'g',
      'LICENSE.spdx': 'h', // the Tauri packages keep their copyright line here
      'README.md': 'no',
      'index.js': 'no',
    });
    expect(noticeFilesIn(dir)).toEqual([
      'COPYING',
      'LICENSE',
      'LICENSE-APACHE',
      'LICENSE-MIT',
      'LICENSE.spdx',
      'NOTICE',
      'UNLICENCE',
      'copyright.txt',
    ]);
  });

  it('ignores licence-shaped code and config, and a directory of that name', () => {
    const dir = dirWith({ 'license.ts': 'export const x = 1;', 'license.json': '{}', LICENSE: 'real' });
    mkdirSync(join(dir, 'licenses'));
    expect(noticeFilesIn(dir)).toEqual(['LICENSE']);
  });

  it('returns nothing for a package that is not installed', () => {
    expect(noticeFilesIn(join(tmpdir(), 'hc-notices-does-not-exist'))).toEqual([]);
  });
});

describe('readNotice', () => {
  it('keeps a Latin-1 copyright line readable instead of mangling the name', () => {
    const dir = dirWith({ LICENSE: Buffer.from('Copyright (c) Jörg Müller\n', 'latin1') });
    const text = readNotice(join(dir, 'LICENSE'));
    expect(text).toBe('Copyright (c) Jörg Müller');
    expect(text).not.toContain('�');
  });

  it('reads UTF-8 as UTF-8 and squares up line endings and padding', () => {
    const dir = dirWith({ LICENSE: '\n\nCopyright (c) Jörg Müller\r\nAll rights reserved.\n\n\n' });
    expect(readNotice(join(dir, 'LICENSE'))).toBe('Copyright (c) Jörg Müller\nAll rights reserved.');
  });
});

describe('fence', () => {
  it('out-lengths any backtick run in the notice', () => {
    expect(fence('plain text')).toBe('```');
    expect(fence('use `cargo` to build')).toBe('```');
    expect(fence('a ``` block inside a licence')).toBe('````');
    expect(fence('nested ````` run')).toBe('``````');
  });
});
