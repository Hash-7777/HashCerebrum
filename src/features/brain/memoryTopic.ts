// Helpers that decide what a research turn contributes to project memory, so
// memory stays a valuable, subject-organised knowledge base rather than a dump
// of every query and every retrieved record.
//
// The gate is NOT a medical classifier — the only medical lexicon in the app is
// the brain-region MeSH subset (for 3D lighting), which knows neuro terms but
// not "renal"/"hepatic"/drug names, so it would wrongly reject most findings.
// Instead a finding is kept when it (a) is not a meta/app question and (b) the
// answer actually cited retrieved evidence — both decided in memoryChunksForTurn,
// which every path that finishes a research turn calls.

import type { EvidenceItem } from '@platform/index';
import { classifyEvidenceStrength } from '@core/rag';
import { isMetaOrAppQuestion } from '@core/llm/safety';
import type { NewRagChunk } from '@core/store/ragStore';
import { isConfidentGeneReport, isConfidentInteractionReport } from './swarm/boss';

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

/**
 * What a finished research turn saves into project memory: the evidence the
 * answer actually cited plus the answer itself, filed under a clean subject
 * label. Returns null when the turn should save nothing:
 *   • a meta / app-introspection question,
 *   • a question with no subject words left once filler is stripped,
 *   • an answer that cited nothing (a refusal or a no-evidence answer), or
 *   • a drug-interaction or genetics turn without a confident result, so shared
 *     memory is fed clear verdicts and not "insufficient evidence" reports.
 * A drug-interaction or genetics turn tags its chunks with that domain so its
 * own retrieval stays isolated to it.
 */
export function memoryChunksForTurn(opts: {
  question: string;
  answer: string;
  evidence: EvidenceItem[];
  runId: string;
  focus?: 'drug_interactions' | 'genetics';
}): NewRagChunk[] | null {
  const memoryTopic = memoryTopicLabel(opts.question);
  const citableForMemory = citedEvidenceFor(opts.answer, opts.evidence);
  const confident =
    opts.focus === 'drug_interactions'
      ? isConfidentInteractionReport(opts.answer)
      : opts.focus === 'genetics'
        ? isConfidentGeneReport(opts.answer)
        : true;
  if (!memoryTopic || citableForMemory.length === 0 || isMetaOrAppQuestion(opts.question) || !confident) {
    return null;
  }
  const memoryTag = opts.focus;
  const evidenceChunks: NewRagChunk[] = citableForMemory.map((item) => {
    const strength = classifyEvidenceStrength(
      [item.title, item.snippet ?? ''].join(' '),
      item.source,
    );
    return {
      kind: 'evidence',
      title: item.title,
      text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
      source: item.source,
      runId: opts.runId,
      query: memoryTopic,
      // Carry the medical metadata forward so memory ranks by evidence
      // strength + recency (search/ranking.ts), not just text overlap.
      ...(item.url ? { url: item.url } : {}),
      ...(item.year != null ? { year: item.year } : {}),
      ...(item.identifiers?.pmid ? { pmid: item.identifiers.pmid } : {}),
      ...(item.identifiers?.doi ? { doi: item.identifiers.doi } : {}),
      ...(item.authors?.length ? { authors: item.authors.slice(0, 8) } : {}),
      ...(strength ? { evidenceStrength: strength } : {}),
      ...(memoryTag ? { tag: memoryTag } : {}),
    };
  });
  const answerChunk: NewRagChunk = {
    kind: 'answer',
    title: memoryTopic,
    text: opts.answer,
    source: 'answer',
    runId: opts.runId,
    query: memoryTopic,
    ...(memoryTag ? { tag: memoryTag } : {}),
  };
  return [...evidenceChunks, answerChunk];
}
