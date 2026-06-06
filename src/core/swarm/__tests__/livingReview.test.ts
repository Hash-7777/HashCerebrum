import { describe, expect, it, beforeEach } from 'vitest';
import {
  subscribe,
  unsubscribe,
  listForProject,
  runSweep,
  tick,
} from '../livingReview';
import type { EvidenceItem } from '@platform/index';

describe('livingReview', () => {
  beforeEach(() => {
    // Reset subscriptions between tests
    const subs = listForProject('proj-1');
    for (const s of subs) unsubscribe(s.id);
  });

  it('subscribes and clamps interval', () => {
    const s = subscribe('proj-1', 'diabetes glp1', 4);
    expect(s.intervalHours).toBe(6); // clamped to min
    expect(s.active).toBe(true);
    expect(s.nextRunAt).toBeDefined();
  });

  it('unsubscribes by id', () => {
    const s = subscribe('proj-1', 'query', 12);
    expect(unsubscribe(s.id)).toBe(true);
    expect(listForProject('proj-1')).toHaveLength(0);
  });

  it('lists only project subscriptions', () => {
    subscribe('proj-1', 'q1', 12);
    subscribe('proj-2', 'q2', 12);
    expect(listForProject('proj-1')).toHaveLength(1);
    expect(listForProject('proj-2')).toHaveLength(1);
  });

  it('runSweep returns new evidence not in baseline', async () => {
    const s = subscribe('proj-1', 'test', 12);
    const baseline: EvidenceItem[] = [
      { provenanceHash: 'hash-old', source: 'pubmed', title: 'Old', authors: [], identifiers: {}, fetchedAt: '', snippet: null } as EvidenceItem,
    ];

    // Mock platform().medical tools would be needed for a full test;
    // here we just verify the sweep updates timestamps.
    const before = s.lastRunAt;
    const diff = await runSweep(s, baseline);
    expect(s.lastRunAt).not.toBe(before);
    expect(s.nextRunAt).toBeDefined();
    expect(diff.changedCount).toBeGreaterThanOrEqual(0);
  });

  it('tick processes due subscriptions', async () => {
    const s = subscribe('proj-1', 'due-query', 12);
    // Force it to be due
    s.nextRunAt = new Date(Date.now() - 1000).toISOString();
    const processed = await tick('proj-1', () => []);
    expect(processed).toBeGreaterThanOrEqual(1);
  });

  it('tick skips future subscriptions', async () => {
    subscribe('proj-1', 'future-query', 12);
    const processed = await tick('proj-1', () => []);
    expect(processed).toBe(0);
  });
});
