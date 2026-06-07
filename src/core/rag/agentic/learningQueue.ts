/**
 * Active Learning Queue — gaps the agent has identified and should fill.
 *
 * After each research run, `assessCoverage` produces missing concepts.
 * These are enqueued with a priority score. A background sweep (or the
 * next user query) can pop the highest-priority items and run targeted
 * searches to fill them.
 *
 * Zero model calls. Deterministic.
 */

import type { LearningQueueItem } from './types';

function now(): string {
  return new Date().toISOString();
}

export function enqueueGap(
  queue: LearningQueueItem[],
  projectId: string,
  concept: string,
  partialEvidence: string[] = [],
): LearningQueueItem[] {
  const existing = queue.find(
    (q) => q.projectId === projectId && q.concept.toLowerCase() === concept.toLowerCase() && q.status !== 'done',
  );
  if (existing) {
    // Bump priority if more partial evidence accumulates
    return queue.map((q) =>
      q.id === existing.id
        ? {
            ...q,
            priority: Math.min(1, q.priority + 0.05 * partialEvidence.length),
            partialEvidence: [...new Set([...q.partialEvidence, ...partialEvidence])],
          }
        : q,
    );
  }

  const item: LearningQueueItem = {
    id: crypto.randomUUID(),
    projectId,
    concept,
    query: `systematic review ${concept} clinical trial`,
    priority: computePriority(concept, partialEvidence.length),
    status: 'pending',
    discoveredAt: now(),
    resolvedAt: null,
    partialEvidence,
  };

  return [...queue, item];
}

function computePriority(concept: string, partialCount: number): number {
  let score = 0.5;
  // Core medical concepts get higher priority
  if (/\b(diabetes|hypertension|cancer|stroke|mi|heart failure|mortality|safety)\b/i.test(concept)) score += 0.2;
  // Drug names get high priority
  if (/\b(metformin|aspirin|statin|warfarin|insulin|clopidogrel)\b/i.test(concept)) score += 0.15;
  // More partial evidence = higher confidence we need this
  score += Math.min(0.15, partialCount * 0.03);
  return Math.min(1, score);
}

export function resolveItem(queue: LearningQueueItem[], id: string): LearningQueueItem[] {
  return queue.map((q) => (q.id === id ? { ...q, status: 'done' as const, resolvedAt: now() } : q));
}

export function staleOldItems(queue: LearningQueueItem[], maxAgeDays = 30): LearningQueueItem[] {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return queue.map((q) => {
    if (q.status === 'pending' && new Date(q.discoveredAt).getTime() < cutoff) {
      return { ...q, status: 'stale' as const };
    }
    return q;
  });
}

export function topPending(queue: LearningQueueItem[], limit = 5): LearningQueueItem[] {
  return queue
    .filter((q) => q.status === 'pending')
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);
}

export function queueForProject(queue: LearningQueueItem[], projectId: string): LearningQueueItem[] {
  return queue.filter((q) => q.projectId === projectId);
}
