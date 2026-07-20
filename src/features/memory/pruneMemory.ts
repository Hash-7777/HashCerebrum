// Decides whether a saved memory chunk is worth keeping, for the one-click
// "Prune" cleanup of existing project memory. Two gates, both conservative so
// good findings are never dropped:
//   1. drop chunks whose topic is a meta / app-introspection / prompt-injection
//      question (these are not research at all);
//   2. drop an evidence record that shares no key term with its own topic query
//      (the off-topic retrieval that was dumped in alongside a real topic),
//      with medical-synonym awareness so a "kidney" paper still matches a
//      "renal" topic.
//
// We deliberately do NOT use the brain-region MeSH classifier as a medical
// gate: it only knows neuro terms, so it would wrongly delete renal / hepatic /
// drug-named findings.

import type { RagChunk } from '@core/store/ragStore';
import { isMetaOrAppQuestion, isPromptInjection } from '@features/brain/swarm/paper';

/** Neither an app-introspection topic nor an injected instruction is ever a
 *  medical finding, so both are pruned on the same gate. Injection is checked
 *  here as well as at the run gate because a chunk may predate that gate. */
function isNotAFinding(query: string, title: string): boolean {
  return (
    isMetaOrAppQuestion(query) ||
    isMetaOrAppQuestion(title) ||
    isPromptInjection(query) ||
    isPromptInjection(title)
  );
}

const FILLER = new Set([
  'about', 'after', 'against', 'among', 'and', 'any', 'are', 'between', 'both', 'compare', 'comparison',
  'does', 'effect', 'effects', 'evidence', 'for', 'from', 'have', 'high', 'how', 'into', 'its', 'low',
  'more', 'most', 'only', 'over', 'paper', 'patient', 'patients', 'research', 'review', 'risk', 'safety',
  'than', 'that', 'their', 'them', 'these', 'this', 'those', 'using', 'versus', 'want', 'what', 'which',
  'with', 'within', 'your', 'just', 'safer', 'which',
]);

const SYNONYMS: Record<string, string[]> = {
  renal: ['kidney'],
  kidney: ['renal'],
  cardiac: ['heart', 'cardiovascular'],
  heart: ['cardiac', 'cardiovascular'],
  cardiovascular: ['cardiac', 'heart'],
  hepatic: ['liver'],
  liver: ['hepatic'],
  pulmonary: ['lung'],
  lung: ['pulmonary'],
  gastric: ['stomach', 'gastrointestinal'],
  gastrointestinal: ['gastric', 'gi'],
};

function topicTerms(query: string): string[] {
  const base = [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !FILLER.has(w)),
    ),
  ];
  const expanded = new Set(base);
  for (const term of base) for (const syn of SYNONYMS[term] ?? []) expanded.add(syn);
  return [...expanded];
}

// Lexical off-topic test: an evidence record that shares no key term with its
// own topic query. The conservative fallback used when no embedding is
// available for the semantic check.
function lexicalOffTopic(chunk: RagChunk, query: string): boolean {
  const terms = topicTerms(query);
  if (terms.length === 0) return false;
  const hay = `${chunk.title} ${chunk.text}`.toLowerCase();
  return !terms.some((term) => {
    try {
      return new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(hay);
    } catch {
      return hay.includes(term);
    }
  });
}

/** True when the chunk should stay in memory; false marks it for pruning.
 *  Kept as the lexical-only fast path (no vectors); planPrune is the richer
 *  semantic/dedup planner used by the one-click Prune flow. */
export function keepMemoryChunk(chunk: RagChunk): boolean {
  const query = chunk.query ?? '';
  // Gate 1 — a meta / app-introspection topic is never a real finding.
  if (isNotAFinding(query, chunk.title)) return false;
  // Gate 2 — an evidence record must be on-topic for its own query.
  if (chunk.kind === 'evidence' && query && lexicalOffTopic(chunk, query)) return false;
  return true;
}

// ── Rich prune planner ───────────────────────────────────────────────────────
// Returns a transparent, reversible plan: which chunks to remove and WHY, using
// the embeddings already stored for each finding for an accurate relevance and
// near-duplicate check, with the lexical gate as a fallback.

export type PruneReason = 'meta' | 'off-topic' | 'duplicate' | 'low-value';

export interface PruneDecision {
  chunk: RagChunk;
  reason: PruneReason;
  /** Human-readable explanation shown in the preview. */
  detail?: string;
}

export interface PrunePlan {
  remove: PruneDecision[];
  removeIds: Set<string>;
  keptCount: number;
  counts: Record<PruneReason, number>;
}

export interface PlanPruneOptions {
  /** chunk id → stored embedding, for semantic relevance and dedup. */
  vectors?: Map<string, Float32Array>;
  /** topic query string → embedding, for the semantic relevance gate. */
  queryVectors?: Map<string, Float32Array>;
  /** Below this cosine to its own topic, an evidence chunk is off-topic. */
  relevanceThreshold?: number;
  /** At or above this cosine, two evidence chunks are near-duplicates. */
  duplicateThreshold?: number;
  /** Also drop context-only / identifier-less evidence (off by default). */
  aggressive?: boolean;
}

const STRENGTH_RANK: Record<string, number> = { strong: 3, moderate: 2, weak: 1, context: 0 };

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

// When two findings are near-identical, keep the most valuable: stronger
// evidence first, then one carrying a PMID/DOI, then the fuller text.
function chunkQuality(chunk: RagChunk): number {
  let score = (STRENGTH_RANK[chunk.evidenceStrength ?? 'weak'] ?? 1) * 1000;
  if (chunk.pmid || chunk.doi) score += 300;
  score += Math.min(chunk.text.length, 4000) / 20;
  return score;
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function planPrune(chunks: RagChunk[], options: PlanPruneOptions = {}): PrunePlan {
  const relevanceThreshold = options.relevanceThreshold ?? 0.2;
  const duplicateThreshold = options.duplicateThreshold ?? 0.93;
  const vectors = options.vectors;
  const queryVectors = options.queryVectors;

  const decisions = new Map<string, PruneDecision>();
  const survivors: RagChunk[] = [];

  for (const chunk of chunks) {
    const query = chunk.query ?? '';
    // 1. Meta / app-introspection topics are never real findings.
    if (isNotAFinding(query, chunk.title)) {
      decisions.set(chunk.id, { chunk, reason: 'meta', detail: 'app/meta question, not research' });
      continue;
    }
    // 2. Off-topic — evidence that does not match its own topic. Prefer the
    //    semantic check (chunk vs query embedding); fall back to lexical.
    if (chunk.kind === 'evidence' && query) {
      const qv = queryVectors?.get(query);
      const cv = vectors?.get(chunk.id);
      if (qv && cv) {
        const sim = cosine(cv, qv);
        if (sim < relevanceThreshold) {
          decisions.set(chunk.id, {
            chunk,
            reason: 'off-topic',
            detail: `low topical similarity (${sim.toFixed(2)})`,
          });
          continue;
        }
      } else if (lexicalOffTopic(chunk, query)) {
        decisions.set(chunk.id, { chunk, reason: 'off-topic', detail: 'shares no key term with its topic' });
        continue;
      }
    }
    // 3. Aggressive: drop weakest, unsourced evidence.
    if (options.aggressive && chunk.kind === 'evidence') {
      const contextOnly = chunk.evidenceStrength === 'context';
      const noIdentifier = !chunk.pmid && !chunk.doi && !chunk.url;
      if (contextOnly || noIdentifier) {
        decisions.set(chunk.id, {
          chunk,
          reason: 'low-value',
          detail: contextOnly ? 'context-only evidence' : 'no source identifier',
        });
        continue;
      }
    }
    survivors.push(chunk);
  }

  // 4. Near-duplicate collapse over surviving evidence (needs vectors). Greedy:
  //    rank by quality, keep the best of each near-identical cluster.
  if (vectors) {
    const ranked = survivors
      .filter((chunk) => chunk.kind === 'evidence' && vectors.has(chunk.id))
      .sort((a, b) => chunkQuality(b) - chunkQuality(a));
    const claimed = new Set<string>();
    for (const keep of ranked) {
      if (claimed.has(keep.id)) continue;
      const kv = vectors.get(keep.id)!;
      for (const other of ranked) {
        if (other.id === keep.id || claimed.has(other.id)) continue;
        if (other.projectId !== keep.projectId) continue;
        const ov = vectors.get(other.id)!;
        if (cosine(kv, ov) >= duplicateThreshold) {
          claimed.add(other.id);
          decisions.set(other.id, {
            chunk: other,
            reason: 'duplicate',
            detail: `near-duplicate of "${truncate(keep.title, 56)}"`,
          });
        }
      }
    }
  }

  const remove = [...decisions.values()];
  const counts: Record<PruneReason, number> = { meta: 0, 'off-topic': 0, duplicate: 0, 'low-value': 0 };
  for (const decision of remove) counts[decision.reason] += 1;
  return {
    remove,
    removeIds: new Set(remove.map((decision) => decision.chunk.id)),
    keptCount: chunks.length - remove.length,
    counts,
  };
}
