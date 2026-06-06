import { describe, expect, it, beforeEach } from 'vitest';
import {
  postEntry,
  resolveEntry,
  getEntries,
  getUnresolved,
  getByType,
  clearRun,
  summariseForBoss,
} from '../blackboard';

describe('blackboard', () => {
  beforeEach(() => {
    clearRun('run-test');
  });

  it('posts and retrieves entries', () => {
    const e = postEntry('run-test', 'cardio', 'hypothesis-posted', 'H1', 'Body', 0.85);
    expect(e.runId).toBe('run-test');
    expect(e.agentId).toBe('cardio');
    expect(e.type).toBe('hypothesis-posted');
    expect(e.resolved).toBe(false);
    expect(getEntries('run-test')).toHaveLength(1);
  });

  it('returns newest first', () => {
    postEntry('run-test', 'a', 'hypothesis-posted', 'First', '', 0.5);
    postEntry('run-test', 'b', 'hypothesis-posted', 'Second', '', 0.6);
    const entries = getEntries('run-test');
    expect(entries[0]?.title).toBe('Second');
    expect(entries[1]?.title).toBe('First');
  });

  it('resolves an entry', () => {
    const e = postEntry('run-test', 'a', 'evidence-flagged', 'F1', '', 0.7);
    expect(getUnresolved('run-test')).toHaveLength(1);
    expect(resolveEntry('run-test', e.id)).toBe(true);
    expect(getUnresolved('run-test')).toHaveLength(0);
  });

  it('filters by type', () => {
    postEntry('run-test', 'a', 'hypothesis-posted', 'H', '', 0.5);
    postEntry('run-test', 'b', 'contradiction-detected', 'C', '', 0.5);
    expect(getByType('run-test', 'hypothesis-posted')).toHaveLength(1);
    expect(getByType('run-test', 'contradiction-detected')).toHaveLength(1);
    expect(getByType('run-test', 'peer-review-requested')).toHaveLength(0);
  });

  it('clears a run', () => {
    postEntry('run-test', 'a', 'hypothesis-posted', 'H', '', 0.5);
    clearRun('run-test');
    expect(getEntries('run-test')).toHaveLength(0);
  });

  it('summarises for boss', () => {
    postEntry('run-test', 'cardio', 'hypothesis-posted', 'H1', 'hypothesis body', 0.9);
    postEntry('run-test', 'neuro', 'contradiction-detected', 'C1', 'contradiction body', 0.7);
    const summary = summariseForBoss('run-test');
    expect(summary).toContain('HYP');
    expect(summary).toContain('CONTRA');
    expect(summary).toContain('90%');
    expect(summary).toContain('70%');
  });

  it('returns empty summary when no unresolved entries', () => {
    expect(summariseForBoss('run-test')).toBe('');
  });
});
