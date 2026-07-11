import { describe, expect, it } from 'vitest';
import { diseaseCoreFor, entitySearchQueries } from '../entityBackfill';

describe('entitySearchQueries', () => {
  it('builds a gene + disease query for each named gene (the MTHFR/F5 miss)', () => {
    const q =
      'evidence review comparing the association of the MTHFR and F5 genes with risk of recurrent venous thromboembolism';
    const queries = entitySearchQueries(q);
    // One targeted query per gene, each carrying the disease/outcome phrase.
    expect(queries.some((s) => s.startsWith('MTHFR '))).toBe(true);
    expect(queries.some((s) => s.startsWith('F5 '))).toBe(true);
    for (const s of queries) {
      expect(s).toContain('thromboembolism');
      // No request/review-type words leak into the literature query.
      expect(s).not.toContain('evidence');
      expect(s).not.toContain('review');
      expect(s).not.toContain('comparing');
    }
  });

  it('drops review-framing words from the disease core', () => {
    expect(diseaseCoreFor('systematic review of the FOO gene and diabetic nephropathy')).not.toContain('review');
  });

  it('returns nothing when the question names no gene', () => {
    expect(entitySearchQueries('compare warfarin and apixaban for stroke prevention')).toEqual([]);
  });
});
