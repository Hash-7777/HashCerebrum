// Citation-marker normalization shared by the manuscript (publication.ts) and
// message export (messageExport.ts) renumber passes.
//
// The drafting model emits internal source markers in several shapes. The
// single-marker renumber passes only understood the canonical [S8] form, so a
// GROUPED marker — [S25, S27] — or a RANGE — [S1-S4] — leaked verbatim into the
// rendered paper (the peer reviewer saw raw "[S25, S27]" in the prose). This
// module expands every shape into a run of canonical single markers, e.g.
// [S25, S27] -> [S25][S27], so the existing single-marker pass handles them
// uniformly and nothing internal can survive to the page.

// A single citation number, optionally S-prefixed, and optionally trailed by a
// dagger/asterisk footnote glyph that some models (Gemini, GPT-OSS) append —
// e.g. "S5†", "12*". Without tolerating that glyph the whole marker (【S5†】)
// failed to match the closing bracket and leaked raw into the report.
const NUM = 'S?\\d+[†‡✝*]?';
const RANGE = `${NUM}(?:\\s*[-‑–—]\\s*${NUM})?`;
const LIST = `${RANGE}(?:\\s*[,;]\\s*${RANGE})*`;

// Fullwidth / CJK brackets some models emit instead of ASCII brackets.
const ALT_BRACKET = new RegExp(`[【〔［]\\s*(${LIST})\\s*[】〕］]`, 'g');

// Source markers the drafting model wrote OUTSIDE brackets — in parentheses
// ("(S6)", "(S4, S9, S14)") or as a sentence word ("Source S18"). The bracketed
// renumber pass never saw these, so raw internal IDs (and dangling ones like an
// "S18" when only 16 records exist) leaked into the abstract and results. Both
// forms REQUIRE the internal "S" prefix, so an ordinary numeric parenthetical —
// "(148 participants)", "(p = 0.04)", "(2)" — is never rewritten. They are
// converted to the canonical bracket form here so the group pass expands them
// and the downstream renumber pass resolves or drops each one.
const S_NUM = 'S\\d+[†‡✝*]?';
const S_RANGE = `${S_NUM}(?:\\s*[-‑–—]\\s*${S_NUM})?`;
const S_LIST = `${S_RANGE}(?:\\s*[,;]\\s*${S_RANGE})*`;
const PAREN_SOURCE_GROUP = new RegExp(`\\(\\s*(${S_LIST})\\s*\\)`, 'g');
const PROSE_SOURCE = new RegExp(`\\b[Ss]ources?\\s+(${S_NUM})\\b`, 'g');

// A whole bracketed citation group: one or more S-prefixed (or bare) numbers,
// each optionally a range, separated by commas or semicolons.
//   [S8]  [S25, S27]  [S1-S4]  [1, 2; 5]  [S1–S3, S7]  【S5†】
const GROUP = new RegExp(`\\[\\s*(${LIST})\\s*\\]`, 'g');

function expandPart(part: string, maxSpan: number): string | null {
  const range = part.match(/^S?(\d+)[†‡✝*]?\s*[-‑–—]\s*S?(\d+)[†‡✝*]?$/);
  if (range) {
    let lo = Number(range[1]);
    let hi = Number(range[2]);
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (hi < lo) [lo, hi] = [hi, lo];
    if (hi - lo > maxSpan) return null; // malformed "[S1-S9999]" — leave it alone
    let out = '';
    for (let n = lo; n <= hi; n += 1) out += `[S${n}]`;
    return out;
  }
  const single = part.match(/^S?(\d+)[†‡✝*]?$/);
  if (single) return `[S${single[1]}]`;
  return null;
}

/**
 * Expand grouped / ranged / fullwidth citation markers into a run of canonical
 * `[S<n>]` markers. `maxCount` bounds a single range's span so a malformed marker
 * cannot explode the document. Pure and deterministic.
 */
export function expandCitationMarkers(content: string, maxCount: number): string {
  const maxSpan = Math.max(maxCount, 50);
  // Pull out-of-bracket markers (parenthetical groups, prose "Source S#") into
  // the canonical bracket form first, so the group/renumber passes below handle
  // every shape uniformly and nothing internal survives to the page.
  const rebracketed = content.replace(PAREN_SOURCE_GROUP, '[$1]').replace(PROSE_SOURCE, '[$1]');
  const bracketed = rebracketed.replace(ALT_BRACKET, '[$1]');
  return bracketed.replace(GROUP, (full, inner: string) => {
    const parts = inner.split(/\s*[,;]\s*/);
    let expanded = '';
    for (const part of parts) {
      const piece = expandPart(part.trim(), maxSpan);
      if (piece === null) return full; // any unparseable part → leave the group untouched
      expanded += piece;
    }
    return expanded;
  });
}
