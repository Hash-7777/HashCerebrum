import { describe, expect, it } from 'vitest';
import { fuseAndWeight, reciprocalRankFusion, RRF_K } from '../search/fusion';

describe('reciprocalRankFusion', () => {
  it('rewards items ranked highly across multiple lists', () => {
    const scores = reciprocalRankFusion([
      ['a', 'b', 'c'],
      ['b', 'a', 'd'],
    ]);
    // a and b appear high in both lists; c and d appear in only one.
    expect(scores.get('a')!).toBeGreaterThan(scores.get('c')!);
    expect(scores.get('b')!).toBeGreaterThan(scores.get('d')!);
  });
});

describe('fuseAndWeight', () => {
  it('lets a project weight flip the ranking of two close hits', () => {
    // p1 is ranked first (slightly higher RRF base) but down-weighted to 0.6;
    // p2 is ranked second but full weight — and should end up on top.
    const out = fuseAndWeight([['p1', 'p2']], (id) => (id === 'p1' ? 0.6 : 1));
    const base1 = (1 / (RRF_K + 1)) * 0.6;
    const base2 = (1 / (RRF_K + 2)) * 1;
    expect(base2).toBeGreaterThan(base1); // sanity: weighting really flips it
    expect(out[0]!.id).toBe('p2');
  });

  it('sorts by final weighted score, highest first', () => {
    const out = fuseAndWeight([['x', 'y', 'z']], () => 1);
    expect(out.map((h) => h.id)).toEqual(['x', 'y', 'z']);
  });
});
