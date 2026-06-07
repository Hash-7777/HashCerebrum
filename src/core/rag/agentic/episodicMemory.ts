/**
 * Episodic Memory — research session records that the agent can recall.
 *
 * Each research run produces an Episode: the query, findings, gaps,
 * confidence, model used, and outcome. Later queries can check episodic
 * memory to avoid re-researching, to warn about past gaps, or to ask
 * "has anything changed since I last asked this?"
 *
 * Zero model calls. Deterministic.
 */

import type { EvidenceItem } from '@platform/index';
import type { ResearchEpisode } from './types';
import type { SpecialistResult } from '@features/brain/swarm/types';

function now(): string {
  return new Date().toISOString();
}

export interface EpisodeInput {
  projectId: string;
  query: string;
  subQueries: string[];
  evidence: EvidenceItem[];
  gaps: string[];
  modelUsed: string;
  specialists: SpecialistResult[];
  citedChunks: string[];
}

export function createEpisode(input: EpisodeInput): ResearchEpisode {
  return {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    query: input.query,
    subQueries: input.subQueries,
    evidenceCount: input.evidence.length,
    gaps: input.gaps,
    confidence: computeConfidence(input),
    modelUsed: input.modelUsed,
    citedChunks: input.citedChunks,
    outcome: 'unknown',
    createdAt: now(),
  };
}

function computeConfidence(input: EpisodeInput): number {
  const evidenceScore = Math.min(1, input.evidence.length / 12);
  const gapPenalty = input.gaps.length > 0 ? 0.15 : 0;
  const specialistScore = input.specialists.length > 0 ? 0.2 : 0;
  const successRate =
    input.specialists.length > 0
      ? input.specialists.filter((s) => s.error === undefined).length / input.specialists.length
      : 0.5;
  return Math.max(0, Math.min(1, evidenceScore + specialistScore - gapPenalty * successRate));
}

export function findSimilarEpisodes(
  episodes: ResearchEpisode[],
  query: string,
  limit = 3,
): ResearchEpisode[] {
  const terms = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
  if (terms.length === 0) return [];
  const scored = episodes
    .map((ep) => {
      const epTerms = new Set(ep.query.toLowerCase().split(/\s+/));
      const shared = terms.filter((t) => epTerms.has(t)).length;
      const overlap = shared / Math.max(terms.length, epTerms.size);
      return { episode: ep, score: overlap };
    })
    .filter((s) => s.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.episode);
  return scored;
}

export function hasSignificantGapChange(
  previous: ResearchEpisode,
  currentGaps: string[],
): { changed: boolean; resolved: string[]; newGaps: string[] } {
  const prevSet = new Set(previous.gaps);
  const currSet = new Set(currentGaps);
  const resolved = [...prevSet].filter((g) => !currSet.has(g));
  const newGaps = [...currSet].filter((g) => !prevSet.has(g));
  return {
    changed: resolved.length > 0 || newGaps.length > 0,
    resolved,
    newGaps,
  };
}

export function episodeSummary(ep: ResearchEpisode): string {
  const date = new Date(ep.createdAt).toLocaleDateString();
  const gapText = ep.gaps.length > 0 ? `Gaps: ${ep.gaps.join(', ')}` : 'No gaps identified';
  return `[${date}] "${ep.query}" — ${ep.evidenceCount} evidence items, confidence ${Math.round(ep.confidence * 100)}%. ${gapText}`;
}
