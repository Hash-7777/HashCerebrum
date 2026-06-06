import { describe, expect, it, beforeEach } from 'vitest';
import {
  castVote,
  computeConsensus,
  rejectedEvidence,
  summariseConsensus,
  clearVotes,
} from '../consensus';

describe('consensus', () => {
  beforeEach(() => {
    clearVotes('run-c');
  });

  it('casts and replaces votes', () => {
    castVote('run-c', 'a1', 'hash-1', 0.8);
    castVote('run-c', 'a1', 'hash-1', 0.6);
    const results = computeConsensus('run-c');
    expect(results).toHaveLength(1);
    expect(results[0]?.meanConfidence).toBeCloseTo(0.6);
    expect(results[0]?.voteCount).toBe(1);
  });

  it('computes mean confidence across agents', () => {
    castVote('run-c', 'a1', 'hash-1', 0.9);
    castVote('run-c', 'a2', 'hash-1', 0.7);
    castVote('run-c', 'a3', 'hash-1', 0.5);
    const r = computeConsensus('run-c')[0];
    expect(r?.meanConfidence).toBeCloseTo(0.7);
    expect(r?.voteCount).toBe(3);
    expect(r?.accepted).toBe(true);
    expect(r?.dissenters).toContain('a3');
  });

  it('rejects evidence below threshold', () => {
    castVote('run-c', 'a1', 'hash-low', 0.4);
    castVote('run-c', 'a2', 'hash-low', 0.5);
    const rejected = rejectedEvidence('run-c');
    expect(rejected).toContain('hash-low');
  });

  it('sorts results by mean confidence descending', () => {
    castVote('run-c', 'a1', 'hash-high', 0.95);
    castVote('run-c', 'a1', 'hash-low', 0.55);
    const results = computeConsensus('run-c');
    expect(results[0]?.evidenceHash).toBe('hash-high');
    expect(results[1]?.evidenceHash).toBe('hash-low');
  });

  it('summarises consensus with evidence lookup', () => {
    castVote('run-c', 'a1', 'hash-1', 0.9);
    const summary = summariseConsensus('run-c', [
      { provenanceHash: 'hash-1', source: 'pubmed', title: 'Test paper' } as any,
    ]);
    expect(summary).toContain('ACCEPTED');
    expect(summary).toContain('pubmed: Test paper');
    expect(summary).toContain('90%');
  });

  it('returns empty summary when no votes', () => {
    expect(summariseConsensus('run-c', [])).toBe('');
  });
});
