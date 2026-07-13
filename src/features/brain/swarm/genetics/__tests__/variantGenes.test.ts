import { describe, expect, it } from 'vitest';
import { genesForQuestion, genesForVariants, resolveVariantToGene } from '../variantGenes';

describe('variant → gene resolution', () => {
  it('resolves legacy substitution notations to their gene', () => {
    expect(resolveVariantToGene('C677T')).toBe('MTHFR');
    expect(resolveVariantToGene('c677t')).toBe('MTHFR');
    expect(resolveVariantToGene('A1298C')).toBe('MTHFR');
    expect(resolveVariantToGene('G20210A')).toBe('F2');
    expect(resolveVariantToGene('R506Q')).toBe('F5');
  });

  it('resolves rsIDs to their gene', () => {
    expect(resolveVariantToGene('rs1801133')).toBe('MTHFR');
    expect(resolveVariantToGene('rs6025')).toBe('F5');
    expect(resolveVariantToGene('rs429358')).toBe('APOE');
  });

  it('returns null for an unknown or non-variant token', () => {
    expect(resolveVariantToGene('BRCA1')).toBeNull();
    expect(resolveVariantToGene('Z999Q')).toBeNull();
    expect(resolveVariantToGene('thrombosis')).toBeNull();
  });

  it('collects genes from variants, rsIDs, and named phrases in a question', () => {
    expect(genesForVariants('is the C677T variant linked to recurrent thrombosis')).toEqual([
      'MTHFR',
    ]);
    expect(genesForVariants('Factor V Leiden and recurrent VTE')).toEqual(['F5']);
    expect(genesForVariants('rs1801133 and rs6025 in VTE')).toEqual(['MTHFR', 'F5']);
  });

  it('genesForQuestion merges symbols and variant-implied genes without duplicates', () => {
    // MTHFR named as a symbol AND as its C677T allele → one entry.
    expect(genesForQuestion('does the MTHFR C677T variant raise VTE risk')).toEqual(['MTHFR']);
    // A variant-only question still yields the gene so it can be scored.
    expect(genesForQuestion('is C677T associated with recurrent thrombosis')).toEqual(['MTHFR']);
  });
});
