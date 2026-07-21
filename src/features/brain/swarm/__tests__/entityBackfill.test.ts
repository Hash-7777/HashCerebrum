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

  it('scopes each gene to its own clause in a multi-part question (the SLCO1B1 miss)', () => {
    // The real bug: this question searched "SLCO1B1 inhibitors receptor agonists
    // major" — it paired the gene with the cardiovascular arm's first words
    // instead of the "simvastatin myopathy" clause that actually names it.
    const q =
      'Write a systematic review comparing SGLT2 inhibitors with GLP-1 receptor agonists for major adverse cardiovascular events; ' +
      'assess whether the SLCO1B1 rs4149056 (c.521T>C) variant modifies simvastatin-associated myopathy risk, with a per-variant confidence assessment';
    const queries = entitySearchQueries(q);
    const slco = queries.find((s) => s.startsWith('SLCO1B1 '));
    expect(slco).toBeDefined();
    // Paired with its own clause's disease terms, not the cardiovascular arm's.
    expect(slco).toContain('simvastatin');
    expect(slco).toContain('myopathy');
    expect(slco).not.toContain('inhibitors');
    expect(slco).not.toContain('receptor');
    expect(slco).not.toContain('agonists');
    // Framing words never leak into the query.
    expect(slco).not.toContain('whether');
    expect(slco).not.toContain('variant');
  });
});
