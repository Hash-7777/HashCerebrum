// Agent Blackboard — reactive shared state for inter-specialist communication.
// Specialists post hypotheses, flag contradictions, and request peer review
// without waiting for the boss synthesis pass. All data is scoped to a
// single research run (project + runId) and ephemeral.

import { bus } from '@core/bus/EventBus';

type BlackboardEventType =
  | 'hypothesis-posted'
  | 'evidence-flagged'
  | 'peer-review-requested'
  | 'contradiction-detected';

export interface BlackboardEntry {
  id: string;
  runId: string;
  agentId: string;
  type: BlackboardEventType;
  title: string;
  body: string;
  confidence: number; // 0–1
  sources: string[]; // source provenance hashes
  postedAt: string;
  resolved: boolean;
}

const store = new Map<string, BlackboardEntry[]>();
let seq = 0;

function key(runId: string): string {
  return `bb:${runId}`;
}

/**
 * Post a new entry to the blackboard for a research run.
 * Emits a `blackboard:updated` event so UI components can react.
 */
export function postEntry(
  runId: string,
  agentId: string,
  type: BlackboardEventType,
  title: string,
  body: string,
  confidence: number,
  sources: string[] = [],
): BlackboardEntry {
  seq += 1;
  const entry: BlackboardEntry = {
    id: `${runId}-${Date.now()}-${seq.toString(36).padStart(6, '0')}`,
    runId,
    agentId,
    type,
    title,
    body,
    confidence: Math.max(0, Math.min(1, confidence)),
    sources,
    postedAt: new Date().toISOString(),
    resolved: false,
  };
  const k = key(runId);
  const list = store.get(k) ?? [];
  list.push(entry);
  store.set(k, list);
  bus.emit('blackboard:updated', { runId, entry });
  return entry;
}

/**
 * Mark a blackboard entry as resolved.
 */
export function resolveEntry(runId: string, entryId: string): boolean {
  const k = key(runId);
  const list = store.get(k);
  if (!list) return false;
  const entry = list.find((e) => e.id === entryId);
  if (!entry) return false;
  entry.resolved = true;
  bus.emit('blackboard:updated', { runId, entry });
  return true;
}

/**
 * Retrieve all entries for a research run, newest first.
 */
export function getEntries(runId: string): BlackboardEntry[] {
  const list = store.get(key(runId)) ?? [];
  return [...list].sort((a, b) => {
    const t = b.postedAt.localeCompare(a.postedAt);
    return t !== 0 ? t : b.id.localeCompare(a.id);
  });
}

/**
 * Retrieve unresolved entries (active hypotheses, open contradictions).
 */
export function getUnresolved(runId: string): BlackboardEntry[] {
  return getEntries(runId).filter((e) => !e.resolved);
}

/**
 * Retrieve entries by type.
 */
export function getByType(runId: string, type: BlackboardEventType): BlackboardEntry[] {
  return getEntries(runId).filter((e) => e.type === type);
}

/**
 * Clear all blackboard data for a run. Called when a run is purged.
 */
export function clearRun(runId: string): void {
  store.delete(key(runId));
  bus.emit('blackboard:cleared', { runId });
}

/**
 * Summarise the blackboard state for inclusion in the boss synthesis prompt.
 */
export function summariseForBoss(runId: string): string {
  const entries = getUnresolved(runId);
  if (entries.length === 0) return '';
  const lines = entries.map((e) => {
    const icon =
      e.type === 'hypothesis-posted'
        ? 'HYP'
        : e.type === 'contradiction-detected'
          ? 'CONTRA'
          : e.type === 'evidence-flagged'
            ? 'FLAG'
            : 'REVIEW';
    return `[${icon}] ${e.agentId}: ${e.title} (confidence ${Math.round(e.confidence * 100)}%)\n${e.body}`;
  });
  return `\n--- Specialist Blackboard (${entries.length} active items) ---\n${lines.join('\n\n')}\n---`;
}
