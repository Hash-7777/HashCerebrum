// Reads THIRDPARTY-NOTICES.md into the shape the Licenses view renders.
//
// The file is generated (scripts/generate-license-notices.mjs) and about a
// megabyte of text, so the view never renders it whole: it lists one row per
// notice and draws a notice's text only when the reader opens it. Parsing is
// pure and lives here so it can be tested without the panel.
//
// The format being read, per notice block:
//
//   ### Notice 7 — LICENSE-APACHE, LICENSE-MIT
//
//   Applies to:
//
//   - crate serde 1.0.228
//   - npm three 0.184.0
//
//   ```text
//   <the notice, exactly as its author published it>
//   ```
//
// A block whose heading or fence does not match is skipped rather than
// guessed at, and `noticeCount` lets the caller see that the file held more
// blocks than were understood.

export interface LicenseNotice {
  /** Stable id for list keys and open/closed state: the block's number. */
  id: string;
  /** The file names this text came from, as the generator recorded them. */
  files: string[];
  /** "crate serde 1.0.228", "npm three 0.184.0", "asset public/fonts/LICENSE.txt". */
  packages: string[];
  /** The notice itself, unmodified. */
  text: string;
}

export interface NoticeDocument {
  /** Everything above the first notice: what the file is and how it is built. */
  preamble: string;
  notices: LicenseNotice[];
  /** Blocks found in the file, including any this parser could not read. */
  blockCount: number;
}

const HEADING = /^### Notice (\S+) — (.+)$/;
const FENCE = /^(`{3,})text$/;

/** Split the document into notices. Never throws: an unreadable file parses
 *  to an empty list, which the view reports as nothing to show. */
export function parseNoticeDocument(raw: string): NoticeDocument {
  const lines = raw.split('\n');
  const firstBlock = lines.findIndex((line) => HEADING.test(line));
  const preamble = (firstBlock === -1 ? lines : lines.slice(0, firstBlock)).join('\n').trim();

  const notices: LicenseNotice[] = [];
  let blockCount = 0;

  for (let i = firstBlock === -1 ? lines.length : firstBlock; i < lines.length; i += 1) {
    const heading = HEADING.exec(lines[i] ?? '');
    if (!heading) continue;
    blockCount += 1;

    const packages: string[] = [];
    let fence: string | null = null;
    let cursor = i + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? '';
      if (HEADING.test(line)) break; // the next block started: this one is malformed
      const open = FENCE.exec(line);
      if (open) {
        fence = open[1] ?? null;
        cursor += 1;
        break;
      }
      if (line.startsWith('- ')) packages.push(line.slice(2).trim());
    }
    if (!fence) continue;

    const body: string[] = [];
    let closed = false;
    for (; cursor < lines.length; cursor += 1) {
      if (lines[cursor] === fence) {
        closed = true;
        break;
      }
      body.push(lines[cursor] ?? '');
    }
    if (!closed) continue;

    notices.push({
      id: heading[1] ?? String(notices.length + 1),
      files: (heading[2] ?? '').split(',').map((name) => name.trim()).filter(Boolean),
      packages,
      text: body.join('\n'),
    });
    i = cursor;
  }

  return { preamble, notices, blockCount };
}

/**
 * Notices whose packages match every word of the query, in any order and in
 * any field — so "three mit" finds the MIT notice three.js ships under. An
 * empty query keeps everything.
 */
export function filterNotices(notices: LicenseNotice[], query: string): LicenseNotice[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return notices;
  return notices.filter((notice) => {
    const haystack = [...notice.packages, ...notice.files].join(' ').toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** How many packages the notices cover, for the one line the view shows. */
export function packageCount(notices: LicenseNotice[]): number {
  return new Set(notices.flatMap((notice) => notice.packages)).size;
}
