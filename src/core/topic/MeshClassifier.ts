// Topic classifier — substring scan over a curated MeSH-subset
// dictionary, mapping each hit to an anatomical region. Designed for
// streaming: callers pass the running content buffer each chunk and
// the classifier returns hits (caller dedupes / throttles).
//
// Why substring not regex word-boundary: MeSH terms include
// hyphens, single-letter shorthand ("CT scan"), and multi-word phrases
// where the previous-character context is irrelevant. Substring keeps
// it predictable.

import type { RegionId } from '@config/agents';
import data from './data/mesh-subset.json';

interface MeshTerm {
  term: string;
  region: RegionId;
  weight: number;
}

interface MeshDict {
  version: number;
  terms: MeshTerm[];
}

// Pre-process: lower-case once, sort by length DESC so a multi-word
// term ("temporal lobe") fires before its shorter sibling ("temporal").
const TERMS: MeshTerm[] = (data as MeshDict).terms
  .map((t) => ({ term: t.term.toLowerCase(), region: t.region, weight: t.weight }))
  .sort((a, b) => b.term.length - a.term.length);

export interface ClassifyHit {
  region: RegionId;
  confidence: number;
  term: string;
}

export function classify(text: string): ClassifyHit[] {
  if (!text) return [];
  const lc = text.toLowerCase();
  const hits: ClassifyHit[] = [];
  const seen = new Set<string>();
  for (const t of TERMS) {
    if (seen.has(t.term)) continue;
    if (lc.includes(t.term)) {
      seen.add(t.term);
      hits.push({ region: t.region, confidence: t.weight, term: t.term });
    }
  }
  return hits;
}

export function classifierSize(): number {
  return TERMS.length;
}
