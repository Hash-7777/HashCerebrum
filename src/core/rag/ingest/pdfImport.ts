// PDF ingestion core — the deterministic, system-level (NO model) pipeline that
// turns a raw extracted PDF into clean, paragraph-aware passages fit for the RAG
// store. This is the part that stops imported papers from landing as a useless
// "word dump": the raw text from the PDF engine arrives as one fragment per
// layout run (and with hyphenated line-breaks, stray page numbers, and broken
// paragraphs), so we reflow it into real sentences/paragraphs first, then chunk
// on paragraph boundaries with a small overlap so a claim that straddles a break
// stays retrievable. Everything here is pure and unit-tested.

/** Lower bound of usable text below which we treat a PDF as scanned/empty. */
export const MIN_USABLE_CHARS = 200;

// --- text cleaning -----------------------------------------------------------

/**
 * Reflow raw PDF-extracted text into readable paragraphs:
 *  - normalise line endings and strip control characters,
 *  - rejoin words split across a line break ("under-\nstanding" → "understanding"),
 *  - drop stray page-number-only lines,
 *  - join wrapped lines into a paragraph, starting a new paragraph at a blank
 *    line or after a line that ends a sentence,
 *  - collapse runs of whitespace.
 * Deterministic; no model involved.
 */
export function cleanPdfText(raw: string): string {
  const normalised = raw
    // Strip control chars except tab/newline.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    // A hyphen stranded on its own line between word fragments.
    .replace(/\s*\n\s*-\s*\n\s*/g, '-')
    // A word split across a line break: "under-\nutilized" → "underutilized".
    .replace(/([A-Za-z])-\n+\s*([a-z])/g, '$1$2');

  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    const trimmed = current.replace(/[ \t]{2,}/g, ' ').trim();
    if (trimmed) paragraphs.push(trimmed);
    current = '';
  };
  for (const rawLine of normalised.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    // A line that is only a page number (or "Page 3", "- 3 -") is layout noise.
    if (/^(page\s+)?[-–—]?\s*\d{1,4}\s*[-–—]?$/i.test(line)) {
      flush();
      continue;
    }
    current = current ? `${current} ${line}` : line;
    // A line that ends a sentence closes the paragraph.
    if (/[.!?]["')\]]?$/.test(line)) flush();
  }
  flush();
  return paragraphs.join('\n\n').trim();
}

/** Fraction of letters/digits — a scanned page often yields gibberish or near
 *  nothing, so a low ratio (or too little text) signals a non-text PDF. */
export function textQuality(cleaned: string): { ok: boolean; reason?: string } {
  const compact = cleaned.replace(/\s+/g, '');
  if (compact.length < MIN_USABLE_CHARS) {
    return { ok: false, reason: 'no readable text — the PDF may be scanned or image-only' };
  }
  const alpha = (compact.match(/[A-Za-z0-9]/g) ?? []).length;
  if (alpha / compact.length < 0.55) {
    return { ok: false, reason: 'unreadable text — the PDF may be scanned or corrupt' };
  }
  return { ok: true };
}

// --- document metadata (best-effort, no model) -------------------------------

const DOI_RX = /\b10\.\d{4,9}\/[^\s"<>]+/i;
const YEAR_RX = /\b(19|20)\d{2}\b/;

function filenameTitle(filename: string): string {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Derive a human title, year, and DOI from the cleaned text — falling back to a
 * cleaned-up filename for the title. Best-effort and deterministic.
 */
export function deriveDocMeta(
  filename: string,
  cleaned: string,
): { title: string; year?: number; doi?: string } {
  const head = cleaned.slice(0, 3000);
  const doiMatch = head.match(DOI_RX);
  const doi = doiMatch ? doiMatch[0].replace(/[.,;)]+$/, '') : undefined;

  // Title: the first "title-like" line near the top — has letters, a sensible
  // length, isn't a bare number/heading-noise, and isn't a DOI/URL line.
  let title = '';
  for (const rawLine of cleaned.split('\n').slice(0, 15)) {
    const line = rawLine.trim().replace(/\s{2,}/g, ' ');
    if (line.length < 8 || line.length > 200) continue;
    if (!/[A-Za-z]/.test(line)) continue;
    if (/^https?:\/\//i.test(line) || DOI_RX.test(line)) continue;
    if (/^(abstract|introduction|contents|references)\b/i.test(line)) continue;
    const letters = (line.match(/[A-Za-z]/g) ?? []).length;
    if (letters / line.length < 0.6) continue; // mostly symbols/numbers
    title = line.replace(/[.\s]+$/, '');
    break;
  }
  if (!title) title = filenameTitle(filename) || 'Imported document';

  const yearMatch = head.match(YEAR_RX);
  const year = yearMatch ? Number(yearMatch[0]) : undefined;

  return {
    title,
    ...(year && year >= 1900 && year <= 2100 ? { year } : {}),
    ...(doi ? { doi } : {}),
  };
}

// --- chunking ----------------------------------------------------------------

export interface DocChunk {
  text: string;
  chunkIndex: number;
}

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
  minChars?: number;
}

/**
 * Split cleaned text into overlapping, paragraph-aware passages. Paragraphs are
 * accumulated up to `targetChars`; the next passage is seeded with the tail
 * (`overlapChars`) of the previous one so a sentence spanning a boundary is
 * still found. A paragraph longer than the target is hard-split on sentence
 * boundaries. Tiny trailing passages are merged back. Deterministic.
 */
export function chunkDocument(text: string, opts: ChunkOptions = {}): DocChunk[] {
  const targetChars = opts.targetChars ?? 1100;
  const overlapChars = opts.overlapChars ?? 180;
  const minChars = opts.minChars ?? 240;

  const paragraphs = splitToParagraphUnits(text, targetChars);
  const passages: string[] = [];
  let buf = '';
  for (const para of paragraphs) {
    if (buf && buf.length + 1 + para.length > targetChars) {
      passages.push(buf);
      const tail = buf.slice(-overlapChars);
      // Start the next passage at a word boundary within the overlap tail.
      const seed = tail.replace(/^\S*\s/, '').trim();
      buf = seed ? `${seed} ${para}` : para;
    } else {
      buf = buf ? `${buf} ${para}` : para;
    }
  }
  if (buf) passages.push(buf);

  // Merge a too-small final passage into its predecessor.
  if (passages.length > 1) {
    const last = passages[passages.length - 1]!;
    if (last.replace(/\s+/g, '').length < minChars) {
      passages[passages.length - 2] = `${passages[passages.length - 2]} ${last}`;
      passages.pop();
    }
  }
  return passages.map((p, i) => ({ text: p.trim(), chunkIndex: i }));
}

/** Split into paragraph units, hard-splitting any paragraph longer than the
 *  target on sentence boundaries so no single unit blows the passage budget. */
function splitToParagraphUnits(text: string, targetChars: number): string[] {
  const units: string[] = [];
  for (const para of text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    if (para.length <= targetChars) {
      units.push(para);
      continue;
    }
    const sentences = para.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [para];
    let seg = '';
    for (const s of sentences) {
      if (seg && seg.length + s.length > targetChars) {
        units.push(seg.trim());
        seg = s;
      } else {
        seg += s;
      }
    }
    if (seg.trim()) units.push(seg.trim());
  }
  return units;
}

// --- content hash (stable document id) ---------------------------------------

/** SHA-256 hex of the file bytes — a stable id so re-importing the same file
 *  (even renamed) dedupes instead of duplicating. Uses Web Crypto. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', view);
  const arr = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < arr.length; i += 1) hex += arr[i]!.toString(16).padStart(2, '0');
  return hex;
}
