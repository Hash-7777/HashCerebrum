// Living Systematic Review Engine — scheduled evidence surveillance that
// re-runs research queries, diffs new evidence against the project's RAG
// memory, and alerts the user to new findings.

import type { EvidenceItem } from '@platform/index';
import { platform } from '@platform/index';
import { notify } from '@platform/notify';

export interface LivingReviewSubscription {
  id: string;
  projectId: string;
  query: string;
  intervalHours: number; // min 6, max 168
  lastRunAt: string | null;
  nextRunAt: string | null;
  active: boolean;
}

export interface LivingReviewDiff {
  newEvidence: EvidenceItem[];
  changedCount: number;
  removedCount: number;
}

const subscriptions: LivingReviewSubscription[] = [];

function nextRun(sub: LivingReviewSubscription): string {
  const base = sub.lastRunAt ? new Date(sub.lastRunAt) : new Date();
  const next = new Date(base.getTime() + sub.intervalHours * 60 * 60 * 1000);
  return next.toISOString();
}

/**
 * Subscribe a query to living review surveillance.
 */
export function subscribe(
  projectId: string,
  query: string,
  intervalHours = 24,
): LivingReviewSubscription {
  const clamped = Math.max(6, Math.min(168, intervalHours));
  const sub: LivingReviewSubscription = {
    id: `${projectId}-${Date.now()}`,
    projectId,
    query,
    intervalHours: clamped,
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + clamped * 60 * 60 * 1000).toISOString(),
    active: true,
  };
  subscriptions.push(sub);
  return sub;
}

/**
 * Unsubscribe by ID.
 */
export function unsubscribe(subId: string): boolean {
  const idx = subscriptions.findIndex((s) => s.id === subId);
  if (idx >= 0) {
    subscriptions.splice(idx, 1);
    return true;
  }
  return false;
}

/**
 * List active subscriptions for a project.
 */
export function listForProject(projectId: string): LivingReviewSubscription[] {
  return subscriptions.filter((s) => s.projectId === projectId && s.active);
}

/**
 * Perform a single surveillance sweep for a subscription.
 * Returns the diff between new results and the baseline evidence set.
 */
export async function runSweep(
  sub: LivingReviewSubscription,
  baseline: EvidenceItem[],
): Promise<LivingReviewDiff> {
  // Run the same tools the specialist would use
  const tools = ['pubmed_search', 'europepmc_fetch', 'semantic_scholar_search'];
  const allNew: EvidenceItem[] = [];

  for (const toolName of tools) {
    try {
      const p = platform().medical as unknown as Record<string, (q: { query: string; maxResults: number }) => Promise<{ results: EvidenceItem[] }>>;
      const fn = p[toolName];
      if (!fn) continue;
      const result = await fn({ query: sub.query, maxResults: 10 });
      allNew.push(...result.results);
    } catch {
      // Individual tool failure should not abort the sweep
    }
  }

  const baselineHashes = new Set(baseline.map((e) => e.provenanceHash));
  const newEvidence = allNew.filter((e) => !baselineHashes.has(e.provenanceHash));

  sub.lastRunAt = new Date().toISOString();
  sub.nextRunAt = nextRun(sub);

  return {
    newEvidence,
    changedCount: newEvidence.length,
    removedCount: 0, // We don't track removals in this simplified version
  };
}

/**
 * Tick the living review scheduler. Call this on app startup and periodically.
 * Returns the number of subscriptions that were processed.
 */
export async function tick(projectId: string, getBaseline: (query: string) => EvidenceItem[]): Promise<number> {
  const now = new Date().toISOString();
  const due = subscriptions.filter(
    (s) => s.projectId === projectId && s.active && s.nextRunAt && s.nextRunAt <= now,
  );

  for (const sub of due) {
    const baseline = getBaseline(sub.query);
    const diff = await runSweep(sub, baseline);
    if (diff.newEvidence.length > 0) {
      void notify(
        'New evidence detected',
        `${diff.newEvidence.length} new paper(s) found for "${sub.query}"`,
      );
    }
  }

  return due.length;
}
