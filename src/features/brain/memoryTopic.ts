// Helpers that decide what a research turn contributes to project memory, so
// memory stays a valuable, subject-organised knowledge base rather than a dump
// of every query and every retrieved record.
//
// The gate is NOT a medical classifier — the only medical lexicon in the app is
// the brain-region MeSH subset (for 3D lighting), which knows neuro terms but
// not "renal"/"hepatic"/drug names, so it would wrongly reject most findings.
// Instead a finding is kept when it (a) is not a meta/app question and (b) the
// answer actually cited retrieved evidence — both decided in BrainMode.

import type { EvidenceItem } from '@platform/index';

// Filler words stripped when deriving a memory topic label from a query.
const TOPIC_STOPWORDS = new Set([
  'i', 'me', 'my', 'we', 'you', 'your', 'u', 'the', 'a', 'an', 'of', 'on', 'in', 'for', 'and', 'or',
  'with', 'about', 'to', 'is', 'are', 'do', 'does', 'can', 'could', 'would', 'how', 'what', 'which',
  'want', 'tell', 'give', 'get', 'make', 'show', 'find', 'please', 'so', 'just', 'any', 'some',
  'compare', 'comparison', 'between', 'effect', 'effects', 'study', 'research', 'paper', 'review',
]);

// The evidence records the answer actually cited ([S#]/[n] markers), in order.
// Uncited retrieval is noise and must not be persisted to project memory.
export function citedEvidenceFor(content: string, evidence: EvidenceItem[]): EvidenceItem[] {
  const order: number[] = [];
  const seen = new Set<number>();
  for (const match of content.matchAll(/\[S?(\d+)\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && !seen.has(n)) {
      seen.add(n);
      order.push(n);
    }
  }
  return order.map((n) => evidence[n - 1]).filter((e): e is EvidenceItem => Boolean(e));
}

// A clean subject label for project memory — the query's content words (drug /
// condition names) with filler stripped, e.g. "panadol cataflam renal" — so
// memory is organised by subject rather than by the raw query string. Returns
// null when nothing meaningful remains.
export function memoryTopicLabel(query: string): string | null {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !TOPIC_STOPWORDS.has(w));
  const label = [...new Set(words)].slice(0, 6).join(' ').trim();
  return label || null;
}
