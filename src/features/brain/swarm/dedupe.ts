// Remove near-duplicate paragraphs a weak drafting model emits when it pads a
// section toward a word target — the single most obvious "this is AI slop"
// signal (the same paragraph repeated many times, as seen in a real run where an
// Introduction shipped the same four paragraphs five times over). Pure and
// unit-tested; used at the source so the manuscript stored, shown, and exported
// are all free of the repetition.

/** Normalize a paragraph for comparison: drop citation markers and punctuation,
 *  lowercase, collapse whitespace. Two paragraphs that differ only in markers or
 *  spacing normalize to the same string. */
function normalize(paragraph: string): string {
  return paragraph
    .toLowerCase()
    .replace(/\[s?\d+\]/gi, ' ') // citation markers ([S3] / [3]) are not content
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Content tokens (3+ chars) of a normalized paragraph, as a set. */
function tokenSet(normalized: string): Set<string> {
  return new Set(normalized.split(' ').filter((word) => word.length > 2));
}

/** Jaccard overlap of two token sets — 0 (disjoint) to 1 (identical). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

// A paragraph must have at least this many content tokens before a fuzzy
// (Jaccard) match can drop it — short lines are compared only by exact
// normalized equality, so a legitimately terse sentence is never lost to noise.
const MIN_TOKENS_FOR_FUZZY = 8;

/**
 * Return the paragraphs with near-duplicates removed, preserving order and the
 * first occurrence of each. A later paragraph is dropped when it is an exact
 * normalized repeat of an earlier kept one, or when both are substantial and
 * their token overlap is at or above `threshold` (default 0.85). Non-prose
 * (empty / marker-only) paragraphs are always kept.
 */
export function dedupeParagraphs(paragraphs: string[], threshold = 0.85): string[] {
  const kept: string[] = [];
  const keptNorm: string[] = [];
  const keptSets: Set<string>[] = [];
  for (const paragraph of paragraphs) {
    const norm = normalize(paragraph);
    if (!norm) {
      kept.push(paragraph);
      keptNorm.push(norm);
      keptSets.push(new Set());
      continue;
    }
    const set = tokenSet(norm);
    const isDuplicate = keptNorm.some((earlier, i) => {
      if (earlier === norm) return true; // exact repeat, any length
      const earlierSet = keptSets[i]!;
      return (
        set.size >= MIN_TOKENS_FOR_FUZZY &&
        earlierSet.size >= MIN_TOKENS_FOR_FUZZY &&
        jaccard(set, earlierSet) >= threshold
      );
    });
    if (!isDuplicate) {
      kept.push(paragraph);
      keptNorm.push(norm);
      keptSets.push(set);
    }
  }
  return kept;
}
