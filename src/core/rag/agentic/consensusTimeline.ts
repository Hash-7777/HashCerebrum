/**
 * Consensus Timeline — tracks how scientific consensus on a topic evolves.
 *
 * For a given concept pair (e.g. "aspirin" + "primary prevention"),
 * we bucket findings by year, compute the dominant direction, and
 * detect flips (e.g. "recommended" → "not recommended").
 *
 * Zero model calls. Deterministic aggregation of existing claims.
 */

import type { BeliefState } from './types';

export interface DirectionalBucket {
  year: number;
  positive: number;
  negative: number;
  neutral: number;
  totalScore: number;
  count: number;
  keyChunks: string[];
}

function directionalSignal(text: string): 'positive' | 'negative' | 'neutral' | 'mixed' | 'unknown' {
  const lower = text.toLowerCase();
  const pos = /\b(increased|increase|higher|elevated|improved|improvement|beneficial|effective|efficacious|reduced mortality|lower risk|significant benefit|superior|better outcome|positive|reduced risk|decreased mortality|protective|favourable|favorable)\b/.test(lower);
  const neg = /\b(decreased|decrease|lower|reduced|reduction|decline|worsened|worsening|harmful|ineffective|no effect|no significant|not effective|non-significant|inferior|worse outcome|negative|no benefit|no improvement|increased risk|increased mortality|unfavourable|unfavorable)\b/.test(lower);
  const neu = /\b(no difference|similar|comparable|equivalent|non-inferior|not significantly different|comparable efficacy)\b/.test(lower);
  if (neu && !pos && !neg) return 'neutral';
  if (pos && !neg) return 'positive';
  if (neg && !pos) return 'negative';
  if (pos && neg) return 'mixed';
  return 'unknown';
}

function bucketLabel(bucket: DirectionalBucket): string {
  const { positive, negative, neutral, count } = bucket;
  if (count === 0) return 'No evidence';
  const max = Math.max(positive, negative, neutral);
  if (max === positive) return 'Consensus: positive effect';
  if (max === negative) return 'Consensus: negative effect';
  return 'Consensus: no significant difference';
}

export function buildBuckets(beliefs: BeliefState[], years: Record<string, number>): DirectionalBucket[] {
  const byYear = new Map<number, DirectionalBucket>();

  for (const b of beliefs) {
    for (const chunkId of b.supportingChunks) {
      const year = years[chunkId];
      if (!year || year < 1900) continue;

      let bucket = byYear.get(year);
      if (!bucket) {
        bucket = { year, positive: 0, negative: 0, neutral: 0, totalScore: 0, count: 0, keyChunks: [] };
        byYear.set(year, bucket);
      }

      const dir = directionalSignal(b.representativeText);
      if (dir === 'positive') bucket.positive += b.beliefScore;
      else if (dir === 'negative') bucket.negative += b.beliefScore;
      else if (dir === 'neutral') bucket.neutral += b.beliefScore;
      else bucket.neutral += b.beliefScore * 0.3; // weak partial credit for unknown

      bucket.totalScore += b.beliefScore;
      bucket.count += 1;
      if (!bucket.keyChunks.includes(chunkId)) bucket.keyChunks.push(chunkId);
    }
  }

  return [...byYear.values()].sort((a, b) => a.year - b.year);
}

export interface ConsensusFlip {
  fromYear: number;
  toYear: number;
  fromDirection: string;
  toDirection: string;
  description: string;
}

export function detectFlips(buckets: DirectionalBucket[]): ConsensusFlip[] {
  const flips: ConsensusFlip[] = [];
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1]!;
    const curr = buckets[i]!;
    const prevDir = prev.positive > prev.negative ? 'positive' : prev.negative > prev.positive ? 'negative' : 'neutral';
    const currDir = curr.positive > curr.negative ? 'positive' : curr.negative > curr.positive ? 'negative' : 'neutral';
    if (prevDir !== currDir && prevDir !== 'neutral' && currDir !== 'neutral') {
      flips.push({
        fromYear: prev.year,
        toYear: curr.year,
        fromDirection: prevDir,
        toDirection: currDir,
        description: `Consensus shifted from ${prevDir} (${prev.year}) to ${currDir} (${curr.year}).`,
      });
    }
  }
  return flips;
}

export function buildConsensusSummary(buckets: DirectionalBucket[]): string {
  if (buckets.length === 0) return 'No temporal data available.';
  const latest = buckets[buckets.length - 1]!;
  const flips = detectFlips(buckets);
  const parts: string[] = [];
  parts.push(`Latest consensus (${latest.year}): ${bucketLabel(latest).toLowerCase()}.`);
  if (flips.length > 0) {
    parts.push(`Detected ${flips.length} consensus shift${flips.length === 1 ? '' : 's'}: ${flips.map((f) => f.description).join(' ')}`);
  }
  return parts.join(' ');
}
