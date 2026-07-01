import { describe, expect, it } from 'vitest';
import {
  assessGeneQueryReadiness,
  clarificationMessage,
  extractGeneSymbols,
  extractRsIds,
  hasDiseaseSignal,
  hasGeneSignal,
} from '../geneQueryReadiness';

describe('extractGeneSymbols / extractRsIds', () => {
  it('pulls the gene symbol out of a full sentence for the DB query', () => {
    expect(
      extractGeneSymbols('Association between the MICA gene TT genotype and cardiovascular complications in type 1 diabetes?'),
    ).toContain('MICA');
    // Genetics meta-words in caps must not be mistaken for a gene.
    expect(extractGeneSymbols('DNA and RNA variants')).toEqual([]);
  });

  it('pulls rsIDs', () => {
    expect(extractRsIds('does rs1051792 and rs2596542 matter')).toEqual(['rs1051792', 'rs2596542']);
    expect(extractRsIds('no rsid here')).toEqual([]);
  });
});

describe('hasGeneSignal', () => {
  it('detects gene symbols and rsIDs', () => {
    expect(hasGeneSignal('MICA and diabetes')).toBe(true);
    expect(hasGeneSignal('BRCA1 risk')).toBe(true);
    expect(hasGeneSignal('does rs1051792 matter')).toBe(true);
    expect(hasGeneSignal('TP53')).toBe(true);
  });

  it('does not treat common caps abbreviations as genes', () => {
    expect(hasGeneSignal('DNA testing and the FDA')).toBe(false);
    expect(hasGeneSignal('does this variant cause disease')).toBe(false);
  });
});

describe('hasDiseaseSignal', () => {
  it('detects a disease/phenotype content word', () => {
    expect(hasDiseaseSignal('MICA and diabetes', 'MICA')).toBe(true);
    expect(hasDiseaseSignal('association with cardiovascular complications')).toBe(true);
  });

  it('returns false when only the gene and meta words are present', () => {
    expect(hasDiseaseSignal('MICA polymorphism variant', 'MICA')).toBe(false);
  });
});

describe('assessGeneQueryReadiness', () => {
  it('is ready when both a gene and a disease are present', () => {
    const r = assessGeneQueryReadiness('Is the MICA TT genotype associated with cardiovascular complications?');
    expect(r.ready).toBe(true);
    expect(r.questions).toHaveLength(0);
  });

  it('asks for the gene when only a disease is given', () => {
    const r = assessGeneQueryReadiness('which variant is linked to diabetes');
    expect(r.ready).toBe(false);
    expect(r.hasGene).toBe(false);
    expect(r.questions.join(' ')).toMatch(/gene or variant/i);
  });

  it('asks for the disease when only a gene is given', () => {
    const r = assessGeneQueryReadiness('tell me about the MICA polymorphism');
    expect(r.ready).toBe(false);
    expect(r.hasDisease).toBe(false);
    expect(r.questions.join(' ')).toMatch(/disease or phenotype/i);
  });

  it('asks for both when neither is present', () => {
    const r = assessGeneQueryReadiness('can you analyze a correlation for me');
    expect(r.ready).toBe(false);
    expect(r.questions).toHaveLength(2);
  });

  it('accumulates signal across a multi-turn conversation', () => {
    // gene mentioned earlier, disease in the latest turn → combined is ready.
    const combined = 'I want to study MICA\nokay, against type 1 diabetes';
    expect(assessGeneQueryReadiness(combined).ready).toBe(true);
  });

  it('clarificationMessage lists the questions as bullets', () => {
    const msg = clarificationMessage(assessGeneQueryReadiness('analyze a correlation'));
    expect(msg).toMatch(/- /);
    expect(msg.toLowerCase()).toContain('gene or variant');
  });
});
