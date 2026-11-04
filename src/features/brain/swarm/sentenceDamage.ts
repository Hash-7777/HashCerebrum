// When a guard removes something from a drafted sentence — a citation marker
// that is not in the claim ledger, a statistic its source does not report — the
// sentence is usually still grammatical ("study [S3] reported a benefit" reads
// fine as "study reported a benefit"). But a model sometimes uses the removed
// thing as a noun ("the most recent record is [S12], which…", "significant at
// p = 0.03 and p = 0.01"), and taking it out leaves a hole: "the most recent
// record is, which…", "significant at,, and". A reader cannot tell a hole from
// a typo, and the sentence no longer says anything true.
//
// These checks recognise that damage so the guard can drop the whole sentence
// instead. Dropping is the strict choice: the guard removes more, never less,
// and an honest gap is always better than a mangled claim.

// A function word left directly before punctuation or a closing bracket: the
// noun it introduced was removed.
// "and," / "or," and "that is," are left out: each opens a normal parenthetical.
const DANGLING_FUNCTION_WORD =
  /(?<!\bthat\s)\b(?:is|are|was|were|be|been)\s*[,;:.)\]]|\b(?:at|of|with|than|alongside|between|by|from|to|on|via|versus|vs|like|including)\s*[,;:.)\]]/i;
// Separators with nothing between them.
const EMPTY_SEPARATORS = /,\s*,|;\s*;|\(\s*[,;]?\s*\)|\(\s*[,;]|,\s*\)|,\s*[.;:]/;
// A preposition whose object was removed, now followed by a conjunction:
// "significant at and …", "between and …". ("of which" is grammatical, so
// relative words are not in the list.)
const PREPOSITION_WITHOUT_OBJECT = /\b(?:at|of|with|than|between|by|from|alongside)\s+(?:and|or|but)\b/i;
// A function word followed straight by an opening bracket that used to follow a
// noun: "with (a review in …, 2022)".
const DANGLING_BEFORE_PAREN = /\b(?:with|and|of|by|from|between|alongside|than)\s+\(/i;
// An article left in front of a vowel-led noun it no longer agrees with, after
// a phrase was cut out between them ("a odds ratio").
const BROKEN_ARTICLE = /\ba\s+(?:odds|effect|estimate|increase|interval|absolute|overall)\b/i;

/** Did removing text from this sentence leave it broken? */
export function isDamagedSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (/^[,;:.)\]]/.test(s)) return true; // starts with punctuation
  return (
    DANGLING_FUNCTION_WORD.test(s) ||
    EMPTY_SEPARATORS.test(s) ||
    DANGLING_BEFORE_PAREN.test(s) ||
    PREPOSITION_WITHOUT_OBJECT.test(s) ||
    BROKEN_ARTICLE.test(s)
  );
}
