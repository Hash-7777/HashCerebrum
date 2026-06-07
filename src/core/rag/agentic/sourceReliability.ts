/**
 * Source Reliability — persistent scoring for journals, authors, and sources.
 *
 * Tracks citation count, retraction count, and average evidence strength
 * per source. When a new chunk is ingested, its source gets a score bump.
 * Retractions (detected via PubMed or manual flag) penalise heavily.
 *
 * Zero model calls. Deterministic.
 */

import type { RagChunk } from '../types';
import type { EvidenceStrength } from '../types';
import type { SourceReliability } from './types';

const RETRACTION_PENALTY = 0.35;
const CITATION_BOOST = 0.02;
const MAX_SCORE = 0.98;
const MIN_SCORE = 0.05;
const EVIDENCE_WEIGHT: Record<EvidenceStrength, number> = {
  strong: 1.0,
  moderate: 0.75,
  weak: 0.4,
  context: 0.15,
};

function evidenceWeight(s?: EvidenceStrength): number {
  return s ? EVIDENCE_WEIGHT[s] : 0.5;
}

function now(): string {
  return new Date().toISOString();
}

export function sourceKey(chunk: RagChunk): string {
  // Prefer journal/source name; fall back to source field
  return chunk.source || 'unknown';
}

export function authorKeys(chunk: RagChunk): string[] {
  if (!chunk.authors || chunk.authors.length === 0) return [];
  return chunk.authors.map((a) => `author:${a.trim().toLowerCase()}`);
}

export function updateSourceReliability(
  existing: SourceReliability,
  chunk: RagChunk,
  isRetracted = false,
): SourceReliability {
  const citationCount = existing.citationCount + 1;
  const retractionCount = existing.retractionCount + (isRetracted ? 1 : 0);
  const avgEvidenceStrength =
    (existing.avgEvidenceStrength * existing.citationCount + evidenceWeight(chunk.evidenceStrength)) /
    citationCount;

  let score = existing.score;
  score += CITATION_BOOST * evidenceWeight(chunk.evidenceStrength);
  if (isRetracted) score -= RETRACTION_PENALTY;
  score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));

  return {
    ...existing,
    score,
    citationCount,
    retractionCount,
    avgEvidenceStrength,
    lastUpdatedAt: now(),
  };
}

export function createSourceReliability(source: string, chunk: RagChunk, isRetracted = false): SourceReliability {
  return {
    source,
    score: Math.max(MIN_SCORE, 0.5 + (isRetracted ? -RETRACTION_PENALTY : CITATION_BOOST * evidenceWeight(chunk.evidenceStrength))),
    citationCount: 1,
    retractionCount: isRetracted ? 1 : 0,
    avgEvidenceStrength: evidenceWeight(chunk.evidenceStrength),
    lastUpdatedAt: now(),
  };
}

export function updateReliabilityMap(
  map: Record<string, SourceReliability>,
  chunk: RagChunk,
  isRetracted = false,
): Record<string, SourceReliability> {
  const out = { ...map };
  const keys = [sourceKey(chunk), ...authorKeys(chunk)];
  for (const key of keys) {
    const existing = out[key];
    if (existing) {
      out[key] = updateSourceReliability(existing, chunk, isRetracted);
    } else {
      out[key] = createSourceReliability(key, chunk, isRetracted);
    }
  }
  return out;
}

export function reliabilityForSource(map: Record<string, SourceReliability>, source: string): number {
  return map[source]?.score ?? 0.5;
}

export function flagRetraction(map: Record<string, SourceReliability>, source: string): Record<string, SourceReliability> {
  const existing = map[source];
  if (!existing) return map;
  return {
    ...map,
    [source]: {
      ...existing,
      score: Math.max(MIN_SCORE, existing.score - RETRACTION_PENALTY),
      retractionCount: existing.retractionCount + 1,
      lastUpdatedAt: now(),
    },
  };
}
