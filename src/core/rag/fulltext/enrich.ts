// Enrich retrieved evidence with the single most relevant passage from each
// article's open-access FULL TEXT, instead of relying only on the abstract.
//
// It is bounded (only the top few open-access records) and fail-safe: any record
// without open-access full text, or any fetch/embed failure, simply keeps its
// abstract — so this only ever ADDS depth and never blocks or degrades a run.

import type { EvidenceItem } from '@platform/index';
import { getEmbeddingProvider } from '../embeddings/workerClient';
import type { EmbeddingProvider } from '../types';
import { cosineSim } from '../search/cosine';
import { fetchFullText, type FullTextRef } from './index';

const DEFAULT_LIMIT = 4; // how many open-access records to enrich per run
const MAX_PASSAGES = 40; // cap passages embedded per article
const PASSAGE_CHARS = 900; // rough passage size handed to the embedder
const MIN_PASSAGE_CHARS = 120; // drop headers / tiny fragments, keep real sentences

export interface EnrichDeps {
  /** Injectable for tests. */
  fetch?: (ref: FullTextRef) => Promise<string | null>;
  embedder?: EmbeddingProvider;
  limit?: number;
}

/** The open-access full-text reference for a record, or null when it has none. */
export function openAccessRef(item: EvidenceItem): FullTextRef | null {
  const pmcid = item.identifiers?.pmcid;
  if (pmcid && /^PMC\d+$/i.test(pmcid.trim())) {
    return { source: 'PMC', id: pmcid.trim() };
  }
  return null;
}

// Split full text into passages on blank lines / sentence-ish boundaries, then
// cap each to a sensible length and drop tiny fragments.
export function splitPassages(text: string): string[] {
  const blocks = text
    .split(/\n{2,}|(?<=\.)\s{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= MIN_PASSAGE_CHARS);
  const out: string[] = [];
  for (const block of blocks) {
    if (block.length <= PASSAGE_CHARS) {
      out.push(block);
    } else {
      for (let i = 0; i < block.length; i += PASSAGE_CHARS) {
        const slice = block.slice(i, i + PASSAGE_CHARS).trim();
        if (slice.length >= MIN_PASSAGE_CHARS) out.push(slice);
      }
    }
    if (out.length >= MAX_PASSAGES) break;
  }
  return out.slice(0, MAX_PASSAGES);
}

export async function enrichEvidenceWithFullText(
  query: string,
  evidence: EvidenceItem[],
  deps: EnrichDeps = {},
): Promise<EvidenceItem[]> {
  const fetch = deps.fetch ?? ((ref: FullTextRef) => fetchFullText(ref));
  const embedder = deps.embedder ?? getEmbeddingProvider();
  const limit = deps.limit ?? DEFAULT_LIMIT;
  if (!query.trim() || evidence.length === 0) return evidence;

  // Candidates: the first `limit` records that have open-access full text.
  const candidates: number[] = [];
  for (let i = 0; i < evidence.length && candidates.length < limit; i += 1) {
    if (openAccessRef(evidence[i]!)) candidates.push(i);
  }
  if (candidates.length === 0) return evidence;

  // Passage picking needs embeddings; if the embedder is unavailable, keep abstracts.
  await embedder.warmup();
  if (!embedder.ready) return evidence;
  const [queryVec] = await embedder.embed([query], 'query');
  if (!queryVec) return evidence;

  const out = [...evidence];
  for (const idx of candidates) {
    try {
      const ref = openAccessRef(out[idx]!)!;
      const text = await fetch(ref);
      if (!text) continue;
      const passages = splitPassages(text);
      if (passages.length === 0) continue;
      const vectors = await embedder.embed(passages, 'passage');
      let bestIdx = -1;
      let bestScore = Number.NEGATIVE_INFINITY;
      passages.forEach((_, i) => {
        const vec = vectors[i];
        if (!vec) return;
        const score = cosineSim(queryVec, vec);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      });
      if (bestIdx >= 0) {
        const record = out[idx]!;
        out[idx] = {
          ...record,
          snippet: passages[bestIdx]!,
          // Mark it so the UI / span-citation step knows this came from full text.
          identifiers: { ...record.identifiers, fulltext: 'europepmc' },
        };
      }
    } catch {
      // Keep the abstract for this record.
    }
  }
  return out;
}
