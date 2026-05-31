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
import { isMetaOrAppQuestion } from '@features/brain/swarm/paper';

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

/** True when the chunk should stay in memory; false marks it for pruning. */
export function keepMemoryChunk(chunk: RagChunk): boolean {
  const query = chunk.query ?? '';
  // Gate 1 — a meta / app-introspection topic is never a real finding.
  if (isMetaOrAppQuestion(query) || isMetaOrAppQuestion(chunk.title)) return false;
  // Gate 2 — an evidence record must be on-topic for its own query.
  if (chunk.kind === 'evidence' && query) {
    const terms = topicTerms(query);
    if (terms.length > 0) {
      const hay = `${chunk.title} ${chunk.text}`.toLowerCase();
      if (!terms.some((term) => hay.includes(term))) return false;
    }
  }
  return true;
}
