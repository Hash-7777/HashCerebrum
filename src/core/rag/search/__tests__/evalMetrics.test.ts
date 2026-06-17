import { describe, expect, it } from 'vitest';
import { recallAtK, precisionAtK, reciprocalRank, meanReciprocalRank, ndcgAtK } from '../evalMetrics';

describe('evalMetrics', () => {
  const ranked = ['a', 'b', 'c', 'd'];
  const relevant = new Set(['b', 'd']);

  it('recallAtK', () => {
    expect(recallAtK(ranked, relevant, 2)).toBe(0.5); // only b in top-2
    expect(recallAtK(ranked, relevant, 4)).toBe(1);
    expect(recallAtK(ranked, new Set(), 4)).toBe(0);
  });

  it('precisionAtK', () => {
    expect(precisionAtK(ranked, relevant, 2)).toBe(0.5);
    expect(precisionAtK(ranked, relevant, 0)).toBe(0);
  });

  it('reciprocalRank', () => {
    expect(reciprocalRank(ranked, relevant)).toBe(1 / 2); // first relevant at rank 2
    expect(reciprocalRank(['x', 'y'], relevant)).toBe(0);
  });

  it('meanReciprocalRank', () => {
    expect(meanReciprocalRank([])).toBe(0);
    const mrr = meanReciprocalRank([
      { ranked: ['b', 'a'], relevant },
      { ranked: ['a', 'b'], relevant },
    ]);
    expect(mrr).toBeCloseTo((1 + 0.5) / 2, 5);
  });

  it('ndcgAtK is 1 for a perfect ranking and lower otherwise', () => {
    expect(ndcgAtK(['b', 'd', 'a', 'c'], relevant, 4)).toBeCloseTo(1, 5);
    expect(ndcgAtK(ranked, relevant, 4)).toBeLessThan(1);
    expect(ndcgAtK(ranked, new Set(), 4)).toBe(0);
  });
});
