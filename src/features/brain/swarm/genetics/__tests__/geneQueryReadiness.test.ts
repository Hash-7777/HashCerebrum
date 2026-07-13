import { describe, expect, it } from 'vitest';
import {
  assessGeneQueryReadiness,
  clarificationMessage,
  extractGeneSymbols,
  extractRsIds,
  extractUnrecognizedGeneTokens,
  extractVariantNotations,
  hasDiseaseSignal,
  hasGeneSignal,
  isVariantNotation,
} from '../geneQueryReadiness';

describe('variant / allele notation', () => {
  it('recognises substitution and rsID notations as variants, not gene symbols', () => {
    for (const v of ['C677T', 'A1298C', 'G20210A', 'R506Q', 'V600E', 'rs1801133']) {
      expect(isVariantNotation(v)).toBe(true);
    }
  });

  it('does not treat gene symbols or clinical abbreviations as variants', () => {
    for (const notVariant of ['MTHFR', 'BRCA1', 'C4A', 'T1D', 'T2D', 'thrombosis']) {
      expect(isVariantNotation(notVariant)).toBe(false);
    }
  });

  it('never flags an allele next to a gene noun as an unrecognized gene', () => {
    // The reported bug: "MTHFR C677T variant" made the gate ask whether C677T is a gene.
    const out = extractUnrecognizedGeneTokens(
      'whether the MTHFR C677T variant and the gene ZQKR7 cause recurrent venous thrombosis',
    );
    expect(out).toEqual(['ZQKR7']); // the real invented gene is still caught; the allele is not
  });

  it('does not flag classic thrombophilia alleles framed as variants', () => {
    expect(
      extractUnrecognizedGeneTokens('the factor V G20210A and MTHFR A1298C variants in VTE'),
    ).toEqual([]);
  });

  it('treats a bare allele as a genetic signal so the query is answerable', () => {
    const r = assessGeneQueryReadiness('is the C677T variant linked to recurrent thrombosis');
    expect(r.hasGene).toBe(true);
    expect(r.ready).toBe(true);
  });

  it('extracts named variant notations, excluding rsIDs', () => {
    expect(extractVariantNotations('MTHFR C677T and A1298C with rs1801133')).toEqual([
      'C677T',
      'A1298C',
    ]);
  });
});

describe('extractUnrecognizedGeneTokens', () => {
  it('flags a made-up gene the question frames as a gene', () => {
    const out = extractUnrecognizedGeneTokens(
      'Compare PCSK9 and APOB, and whether the ZXPQ7 gene is associated with coronary artery disease',
    );
    expect(out).toEqual(['ZXPQ7']);
  });

  it('does not flag real genes or ordinary all-caps terms', () => {
    // MACE / SGLT2 are not framed as genes, and BRCA1 is a real symbol.
    const out = extractUnrecognizedGeneTokens(
      'Does the BRCA1 gene raise MACE risk with SGLT2 inhibitors',
    );
    expect(out).not.toContain('BRCA1');
    expect(out).not.toContain('MACE');
    expect(out).not.toContain('SGLT2');
  });

  it('returns nothing when no gene-shaped token is framed as a gene', () => {
    expect(extractUnrecognizedGeneTokens('compare warfarin and apixaban for stroke')).toEqual([]);
  });

  it('catches a mixed-case made-up gene in a plural list (the ZndR4 run)', () => {
    // The real release-blocking miss: mixed case + plural "genes" slipped past.
    const out = extractUnrecognizedGeneTokens(
      'Compare the association between the MTHFR, ACE, and ZndR4 genes and risk of recurrent venous thromboembolism',
    );
    expect(out).toEqual(['ZndR4']);
  });

  it('does not flag a real gene typed next to a plural gene noun', () => {
    expect(extractUnrecognizedGeneTokens('the F5 and MTHFR variants in thrombosis')).toEqual([]);
  });

  it('does not flag ordinary words placed next to a gene noun', () => {
    expect(
      extractUnrecognizedGeneTokens('the candidate genes and disease variants were reviewed'),
    ).toEqual([]);
  });
});

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

  it('never queries the genetic databases for a trial acronym', () => {
    expect(extractGeneSymbols('the TOPCAT trial and a PRISMA diagram')).toEqual([]);
  });
});

describe('hasGeneSignal — only real gene symbols count', () => {
  // The spironolactone-in-HFpEF run: TOPCAT and PRISMA were read as gene symbols,
  // which sent a cardiology question to the gene expert.
  const hfpef = `In adults with heart failure with preserved ejection fraction (HFpEF),
quantify the roughly 30% reduction in cardiovascular mortality that the TOPCAT trial
demonstrated for spironolactone. Give me a publication-ready evidence review with a
pooled hazard ratio and 95% CI, a PRISMA diagram, and a forest plot.`;

  it('does not fire on trial acronyms or reporting guidelines', () => {
    expect(hasGeneSignal(hfpef)).toBe(false);
    for (const acronym of ['SPRINT', 'EMPEROR', 'PARADIGM', 'CONSORT', 'STROBE', 'AMSTAR']) {
      expect(hasGeneSignal(`the ${acronym} trial in heart failure`)).toBe(false);
    }
  });

  it('still fires on a bare unambiguous gene symbol', () => {
    expect(hasGeneSignal('MICA and cardiovascular complications in type 1 diabetes')).toBe(true);
    expect(hasGeneSignal('BRCA1 in breast cancer')).toBe(true);
    expect(hasGeneSignal('outcomes by APOE status')).toBe(true);
  });

  it('requires genetic context for a symbol that is also a clinical abbreviation', () => {
    // "ACE" the gene vs. "ACE inhibitor" the drug class; "CAD" the gene vs. coronary
    // artery disease; "CRP" the gene vs. the inflammatory marker.
    expect(hasGeneSignal('do ACE inhibitors reduce mortality in CAD with elevated CRP')).toBe(false);
    expect(hasGeneSignal('the ACE insertion/deletion polymorphism and hypertension')).toBe(true);
    expect(hasGeneSignal('EGFR mutation status in lung cancer')).toBe(true);
  });

  it('recognises a gene family named as a bare prefix', () => {
    expect(hasGeneSignal('HLA haplotypes in coeliac disease')).toBe(true);
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
