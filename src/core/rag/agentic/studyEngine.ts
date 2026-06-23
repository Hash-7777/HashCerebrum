/**
 * Study Engine — autonomous gap-filling between research runs.
 *
 * Every run enqueues the concepts it could not cover (the active-learning
 * queue), but nothing ever drained that queue, so the "active learning" was
 * inert. This closes it: the agent studies its own open gaps on its own time —
 * fetching trusted literature for the highest-priority gaps, distilling it into
 * citable memory tagged 'study', and marking the gap resolved. The next query
 * on that topic then finds the agent already prepared.
 *
 * The core (runStudyPass / evidenceToChunks) is pure and dependency-injected so
 * it is fully unit-testable; studyTopGaps wires the real platform + stores. No
 * LLM is involved — the study pass is deterministic and works the same whether
 * the user runs cloud models or Ollama.
 */

import type { EvidenceItem } from '@platform/index';
import { platform } from '@platform/index';
import type { NewRagChunk } from '../types';
import { classifyEvidenceStrength } from '../search/ranking';
import { useRagStore } from '../store/ragStore';
import { useLearningStore } from './learningStore';
import { topPending, resolveItem, queueForProject } from './learningQueue';
import { ragDebug } from './debug';
import type { LearningQueueItem } from './types';

/** Findings the agent gathered on its own are tagged so they stay inspectable. */
export const STUDY_TAG = 'study';

export interface StudyDeps {
  /** Fetch citable evidence for a gap query (app wires PubMed + Europe PMC). */
  fetchEvidence: (query: string) => Promise<EvidenceItem[]>;
  /** Persist the chunks distilled from a gap's evidence into project memory. */
  save: (projectId: string, chunks: NewRagChunk[]) => void;
}

export interface StudyResult {
  resolvedIds: string[];
  savedChunks: number;
  attempted: number;
}

/** Distil fetched evidence into deduped, tagged memory chunks for one gap. */
export function evidenceToChunks(items: EvidenceItem[], gap: LearningQueueItem): NewRagChunk[] {
  const seen = new Set<string>();
  const out: NewRagChunk[] = [];
  for (const item of items) {
    const key = item.identifiers?.pmid || item.identifiers?.doi || item.url || item.title;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const strength = classifyEvidenceStrength([item.title, item.snippet ?? ''].join(' '), item.source);
    out.push({
      kind: 'evidence',
      title: item.title,
      text: [item.title, item.snippet ?? ''].filter(Boolean).join(' — '),
      source: item.source,
      query: gap.concept,
      tag: STUDY_TAG,
      ...(item.url ? { url: item.url } : {}),
      ...(item.year != null ? { year: item.year } : {}),
      ...(item.identifiers?.pmid ? { pmid: item.identifiers.pmid } : {}),
      ...(item.identifiers?.doi ? { doi: item.identifiers.doi } : {}),
      ...(item.authors?.length ? { authors: item.authors.slice(0, 8) } : {}),
      ...(strength ? { evidenceStrength: strength } : {}),
    });
  }
  return out;
}

/**
 * Work through a set of gaps, fetching and saving evidence for each. A gap that
 * yields no evidence (or whose fetch fails) is left pending so a later pass can
 * retry it; only gaps actually filled are reported as resolved.
 */
export async function runStudyPass(
  projectId: string,
  gaps: LearningQueueItem[],
  deps: StudyDeps,
): Promise<StudyResult> {
  let savedChunks = 0;
  const resolvedIds: string[] = [];
  for (const gap of gaps) {
    let evidence: EvidenceItem[] = [];
    try {
      evidence = await deps.fetchEvidence(gap.query);
    } catch {
      continue; // source/network failure — leave pending for next time
    }
    const chunks = evidenceToChunks(evidence, gap);
    if (chunks.length === 0) continue;
    deps.save(projectId, chunks);
    savedChunks += chunks.length;
    resolvedIds.push(gap.id);
  }
  return { resolvedIds, savedChunks, attempted: gaps.length };
}

/**
 * Run one autonomous study pass over a project's highest-priority pending gaps,
 * wiring the real literature sources and stores, then mark the filled gaps done.
 * Safe to call fire-and-forget; a no-op when there is nothing pending.
 */
export async function studyTopGaps(projectId: string, limit = 3): Promise<StudyResult> {
  if (!projectId) return { resolvedIds: [], savedChunks: 0, attempted: 0 };
  const queue = useLearningStore.getState().learningQueue;
  const gaps = topPending(queueForProject(queue, projectId), limit);
  if (gaps.length === 0) return { resolvedIds: [], savedChunks: 0, attempted: 0 };
  ragDebug('study:start', { projectId, gaps: gaps.map((g) => g.concept) });

  const med = platform().medical;
  const fetchEvidence = async (query: string): Promise<EvidenceItem[]> => {
    const [pubmed, epmc] = await Promise.allSettled([
      med.pubmed({ query, maxResults: 8 }),
      med.europepmc({ query, maxResults: 8 }),
    ]);
    const items: EvidenceItem[] = [];
    if (pubmed.status === 'fulfilled') items.push(...pubmed.value.results);
    if (epmc.status === 'fulfilled') items.push(...epmc.value.results);
    return items;
  };
  const save = (pid: string, chunks: NewRagChunk[]) => useRagStore.getState().addChunks(pid, chunks);

  const result = await runStudyPass(projectId, gaps, { fetchEvidence, save });

  if (result.resolvedIds.length > 0) {
    let next = useLearningStore.getState().learningQueue;
    for (const id of result.resolvedIds) next = resolveItem(next, id);
    useLearningStore.getState().setLearningQueue(next);
  }
  ragDebug('study:done', { attempted: result.attempted, gapsFilled: result.resolvedIds.length, savedChunks: result.savedChunks });
  return result;
}
