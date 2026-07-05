// Span-level citations: for each cited source [S#] in an answer, find the exact
// sentence in that source which best supports the claim — so a reader can verify a
// citation against the precise text, not just the paper as a whole.
//
// Deterministic and dependency-light: it matches the answer sentences that cite a
// source to the source sentence with the highest word overlap (reusing the RAG
// lexical tokenizer). No model, no network — it just reads what is already on hand.

import { splitSentences } from './honestyGuard';
import { tokenize } from '@core/rag';

interface CitedSource {
  snippet?: string | null;
}

/** Best-overlapping sentence in `sourceText` for the given claim text, or ''. */
export function bestOverlapSentence(claim: string, sourceText: string): string {
  const claimTokens = new Set(tokenize(claim));
  if (claimTokens.size === 0) return '';
  let best = '';
  let bestScore = 0;
  for (const sentence of splitSentences(sourceText)) {
    const tokens = tokenize(sentence);
    if (tokens.length === 0) continue;
    let shared = 0;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (claimTokens.has(t) && !seen.has(t)) {
        shared += 1;
        seen.add(t);
      }
    }
    // Normalise by sentence length so a long sentence doesn't win on sheer size.
    const score = shared / Math.sqrt(tokens.length);
    if (score > bestScore) {
      bestScore = score;
      best = sentence.trim();
    }
  }
  return bestScore > 0 ? best : '';
}

/**
 * One supporting quote per citation, aligned to `citations` order (index i ↔ the
 * `[S(i+1)]`/`[i+1]` marker). Empty string when a source is uncited or nothing
 * overlaps.
 */
export function findSupportingSpans(answer: string, citations: CitedSource[]): string[] {
  const sentences = splitSentences(answer);
  const citingSentences: string[][] = citations.map(() => []);
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(/\[S?0*(\d+)\]/g)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= citations.length) citingSentences[n - 1]!.push(sentence);
    }
  }
  return citations.map((citation, i) => {
    const source = (citation.snippet ?? '').trim();
    const claim = citingSentences[i]!.join(' ').trim();
    if (!source || !claim) return '';
    return bestOverlapSentence(claim, source);
  });
}
