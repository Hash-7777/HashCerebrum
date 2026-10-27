// The parser behind the Licenses view, checked against the real generated file
// as well as planted shapes. The view is the only place a user can read the
// attribution notices, so a notice the parser drops is attribution the user
// never sees — hence the count check against the file on disk.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { filterNotices, packageCount, parseNoticeDocument } from '../noticeDocument';

const block = (n: number, files: string, packages: string[], text: string) =>
  [`### Notice ${n} — ${files}`, '', 'Applies to:', '', ...packages.map((p) => `- ${p}`), '', '```text', text, '```'].join(
    '\n',
  );

describe('parseNoticeDocument', () => {
  it('reads a notice with its files, packages and untouched text', () => {
    const doc = parseNoticeDocument(
      ['# Third-Party Notices', '', 'What this file is.', '', '---', '', '## Notices', '', block(1, 'LICENSE-MIT, NOTICE', ['crate serde 1.0.228', 'npm three 0.184.0'], 'Copyright (c) 2026 Someone\n\nPermission is hereby granted.')].join('\n'),
    );
    expect(doc.preamble).toContain('What this file is.');
    expect(doc.blockCount).toBe(1);
    expect(doc.notices).toHaveLength(1);
    const notice = doc.notices[0]!;
    expect(notice.id).toBe('1');
    expect(notice.files).toEqual(['LICENSE-MIT', 'NOTICE']);
    expect(notice.packages).toEqual(['crate serde 1.0.228', 'npm three 0.184.0']);
    expect(notice.text).toBe('Copyright (c) 2026 Someone\n\nPermission is hereby granted.');
  });

  it('keeps a notice that contains a markdown fence of its own', () => {
    const text = 'Copyright (c) 2026 Someone\n\n```\nnot the end of the notice\n```\n\nEnd.';
    const raw = ['### Notice 1 — LICENSE', '', 'Applies to:', '', '- npm thing 1.0.0', '', '````text', text, '````'].join('\n');
    const doc = parseNoticeDocument(raw);
    expect(doc.notices[0]?.text).toBe(text);
  });

  it('skips a block it cannot read instead of inventing one, and still counts it', () => {
    const doc = parseNoticeDocument(
      [
        '### Notice 1 — LICENSE',
        '',
        'Applies to:',
        '',
        '- npm broken 1.0.0',
        '', // no fence at all
        block(2, 'LICENSE', ['npm fine 1.0.0'], 'Good.'),
      ].join('\n'),
    );
    expect(doc.blockCount).toBe(2);
    expect(doc.notices.map((n) => n.id)).toEqual(['2']);
  });

  it('returns nothing for text that is not a notices file', () => {
    const doc = parseNoticeDocument('# Something else\n\nNo notices here.\n');
    expect(doc.notices).toEqual([]);
    expect(doc.blockCount).toBe(0);
    expect(doc.preamble).toContain('No notices here.');
  });
});

describe('filterNotices', () => {
  const notices = parseNoticeDocument(
    [
      block(1, 'LICENSE-MIT', ['npm three 0.184.0', 'crate serde 1.0.228'], 'MIT text'),
      '',
      block(2, 'LICENSE-APACHE', ['npm pdfjs-dist 4.10.38'], 'Apache text'),
      '',
      block(3, 'LICENSE.txt', ['asset public/fonts/LICENSE.txt'], 'Font text'),
    ].join('\n'),
  ).notices;

  it('matches on package name, version, kind and file name', () => {
    expect(filterNotices(notices, 'three').map((n) => n.id)).toEqual(['1']);
    expect(filterNotices(notices, '4.10.38').map((n) => n.id)).toEqual(['2']);
    expect(filterNotices(notices, 'crate').map((n) => n.id)).toEqual(['1']);
    expect(filterNotices(notices, 'apache').map((n) => n.id)).toEqual(['2']);
    expect(filterNotices(notices, 'fonts').map((n) => n.id)).toEqual(['3']);
  });

  it('needs every word, in any order, and ignores case and padding', () => {
    expect(filterNotices(notices, 'NPM  Three').map((n) => n.id)).toEqual(['1']);
    expect(filterNotices(notices, 'three pdfjs')).toEqual([]);
    expect(filterNotices(notices, '   ')).toHaveLength(3);
  });
});

describe('the generated notices file', () => {
  const raw = readFileSync(fileURLToPath(new URL('../../../../THIRDPARTY-NOTICES.md', import.meta.url)), 'utf8');
  const doc = parseNoticeDocument(raw);

  it('parses completely — every block in the file becomes a notice', () => {
    expect(doc.notices.length).toBeGreaterThan(300);
    expect(doc.notices.length).toBe(doc.blockCount);
  });

  it('gives every notice at least one package and some text', () => {
    const empty = doc.notices.filter((n) => n.packages.length === 0 || n.text.trim().length === 0);
    expect(empty).toEqual([]);
  });

  it('covers the packages that ship in the app', () => {
    const packages = doc.notices.flatMap((n) => n.packages);
    expect(packages).toContain('npm three 0.184.0');
    expect(packages).toContain('npm react 18.3.1');
    expect(packages.some((p) => p.startsWith('crate tauri '))).toBe(true);
    expect(packages).toContain('asset public/models/brain/LICENSE.md');
    expect(packageCount(doc.notices)).toBeGreaterThan(600);
  });
});
