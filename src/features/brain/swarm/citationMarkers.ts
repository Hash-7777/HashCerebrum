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

// Fullwidth / CJK brackets some models emit instead of ASCII brackets.
const ALT_BRACKET = /[【〔［]\s*(S?\d+(?:\s*[-‑–—]\s*S?\d+)?(?:\s*[,;]\s*S?\d+(?:\s*[-‑–—]\s*S?\d+)?)*)\s*[】〕］]/g;

// A whole bracketed citation group: one or more S-prefixed (or bare) numbers,
// each optionally a range, separated by commas or semicolons.
//   [S8]  [S25, S27]  [S1-S4]  [1, 2; 5]  [S1–S3, S7]
const GROUP = /\[\s*(S?\d+(?:\s*[-‑–—]\s*S?\d+)?(?:\s*[,;]\s*S?\d+(?:\s*[-‑–—]\s*S?\d+)?)*)\s*\]/g;

function expandPart(part: string, maxSpan: number): string | null {
  const range = part.match(/^S?(\d+)\s*[-‑–—]\s*S?(\d+)$/);
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
  const single = part.match(/^S?(\d+)$/);
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
  const bracketed = content.replace(ALT_BRACKET, '[$1]');
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
