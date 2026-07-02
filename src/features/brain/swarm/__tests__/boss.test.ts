import { describe, expect, it } from 'vitest';
import {
  collapseMarkerRuns,
  drugCandidates,
  ensureGeneDisclaimer,
  ensureInteractionDisclaimer,
  geneConfidenceHeader,
  isConfidentGeneReport,
  isConfidentInteractionReport,
  isIdentityQuestion,
  looksLikeRefusalOrNonQuery,
  stripLeakedSpecialistLabels,
  unverifiedDrugNames,
} from '../boss';
import type { AssociationConfidence } from '../genetics/associationConfidence';
import type { EvidenceItem } from '@platform/index';

describe('drug-interaction fabrication guard', () => {
  const rec = (title: string, snippet = ''): EvidenceItem => ({
    source: 'pubmed',
    title,
    snippet,
    authors: [],
    identifiers: {},
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'h',
  });

  it('parses candidate drug names and drops connectors', () => {
    expect(drugCandidates('zynteprol and warfarin')).toEqual(expect.arrayContaining(['zynteprol', 'warfarin']));
    expect(drugCandidates('warfarin and ibuprofen')).not.toContain('and');
  });

  it('collapses a long run of citation markers to the first three', () => {
    expect(collapseMarkerRuns('None reported [2][3][4][5][6][7][8].')).toBe('None reported [2][3][4].');
    expect(collapseMarkerRuns('gap [1], [2], [3], [4], [5], [6] here')).toBe('gap [1][2][3] here');
    // A short run (fewer than five) is left alone.
    expect(collapseMarkerRuns('supported [1][2][3]')).toBe('supported [1][2][3]');
  });

  it('drops the leading command verb so it is not treated as a drug', () => {
    const drugs = drugCandidates('Grade the interactions between warfarin, amiodarone, aspirin, and fluconazole');
    expect(drugs).toEqual(expect.arrayContaining(['warfarin', 'amiodarone', 'aspirin', 'fluconazole']));
    expect(drugs).not.toContain('grade');
    expect(drugs).not.toContain('interactions');
  });

  it('flags a drug that appears in no retrieved record', () => {
    const evidence = [rec('Systematic overview of warfarin and its drug and food interactions', 'warfarin interactions')];
    expect(unverifiedDrugNames('zynteprol and warfarin', evidence)).toEqual(['zynteprol']);
  });

  it('does not flag drugs present in the evidence', () => {
    const evidence = [rec('Warfarin and ibuprofen bleeding risk', 'warfarin ibuprofen gastrointestinal')];
    expect(unverifiedDrugNames('warfarin and ibuprofen', evidence)).toEqual([]);
  });
});

describe('looksLikeRefusalOrNonQuery', () => {
  it('flags a model refusal so it never becomes the search query', () => {
    for (const t of [
      "I'm sorry, but I can't help with that.",
      'I cannot help with that request.',
      'I am unable to assist with this.',
      'As an AI language model, I cannot comply.',
    ]) {
      expect(looksLikeRefusalOrNonQuery(t)).toBe(true);
    }
  });

  it('does not flag a genuine rewritten research question', () => {
    for (const t of [
      'What is the efficacy of SGLT2 inhibitors in HFpEF?',
      'Compare warfarin and apixaban for stroke prevention in atrial fibrillation',
      'dapagliflozin and renal outcomes in chronic kidney disease',
    ]) {
      expect(looksLikeRefusalOrNonQuery(t)).toBe(false);
    }
  });
});

describe('isIdentityQuestion', () => {
  it('matches questions about the assistant itself', () => {
    for (const q of [
      'what model r u ?',
      'what model are you',
      'which llm are you?',
      'who are you',
      'who developed you',
      'who made you?',
      'what are you built on',
      'are you gpt-4?',
      'are you chatgpt',
      "what's your underlying model",
    ]) {
      expect(isIdentityQuestion(q)).toBe(true);
    }
  });

  it('does not match genuine research that merely mentions models/AI', () => {
    for (const q of [
      'what AI model best predicts sepsis mortality',
      'which model of care improves diabetes outcomes',
      'what are the side effects of metformin',
      'compare warfarin and apixaban',
    ]) {
      expect(isIdentityQuestion(q)).toBe(false);
    }
  });
});

describe('genetics report helpers', () => {
  const conf = (over: Partial<AssociationConfidence>): AssociationConfidence => ({
    score: 72,
    band: 'strong',
    supportCount: 4,
    refuteCount: 0,
    quantitativeCount: 4,
    totalCount: 5,
    pooledDirection: 'risk',
    rationale: 'test',
    ...over,
  });

  it('builds a deterministic confidence header', () => {
    expect(geneConfidenceHeader(conf({ score: 72, band: 'strong' }))).toBe(
      '**Association confidence: 72% — strong**',
    );
  });

  it('treats a non-insufficient header as confident', () => {
    expect(isConfidentGeneReport(geneConfidenceHeader(conf({ band: 'moderate', score: 50 })))).toBe(true);
    expect(isConfidentGeneReport(geneConfidenceHeader(conf({ band: 'very strong', score: 90 })))).toBe(true);
  });

  it('treats an insufficient header as not confident', () => {
    expect(isConfidentGeneReport(geneConfidenceHeader(conf({ band: 'insufficient', score: 0 })))).toBe(false);
    expect(isConfidentGeneReport('')).toBe(false);
  });

  it('appends the genetics disclaimer once', () => {
    const out = ensureGeneDisclaimer('Gene report body.');
    expect(out.toLowerCase()).toContain('not medical advice');
    expect(ensureGeneDisclaimer(out).toLowerCase().match(/not medical advice/g)?.length).toBe(1);
  });
});

describe('ensureInteractionDisclaimer', () => {
  it('appends the safety footer when the report has no verify-clinician line', () => {
    const out = ensureInteractionDisclaimer('**A ↔ B**\n**Grade: C — Moderate**');
    expect(out.toLowerCase()).toContain('verify every result');
    expect(out.toLowerCase()).toContain('pharmacist or physician');
  });

  it('does not duplicate when the model already closed with a verify-clinician line', () => {
    const withLine =
      '**A ↔ B**\n**Grade: C**\n\n*Informational triage only — verify with a licensed pharmacist or physician before any medication decision.*';
    const out = ensureInteractionDisclaimer(withLine);
    expect(out).toBe(withLine.trimEnd());
    expect(out.toLowerCase().match(/verify/g)?.length).toBe(1);
  });
});

describe('isConfidentInteractionReport', () => {
  it('keeps a clear verdict (including a confident "no interaction")', () => {
    expect(isConfidentInteractionReport('**Verdict:** Established interaction — CYP3A4 inhibition [S1].')).toBe(true);
    expect(
      isConfidentInteractionReport('**Verdict:** No clinically significant interaction is expected [S2].'),
    ).toBe(true);
  });

  it('rejects an unsure report so the shared memory is fed only sure answers', () => {
    expect(isConfidentInteractionReport('**Verdict:** Insufficient evidence to assess this combination.')).toBe(false);
    expect(isConfidentInteractionReport('The interaction could not be established from the retrieved records.')).toBe(false);
    expect(isConfidentInteractionReport('')).toBe(false);
  });
});

describe('stripLeakedSpecialistLabels', () => {
  it('removes leaked internal specialist-label pseudo-citations', () => {
    const cleaned = stripLeakedSpecialistLabels(
      'SGLT-2 inhibitors are disease-modifying in HFrEF [S18] [Specialist Findings - Clinical trials]. ' +
        'They share a class effect [Specialist Findings - Pharmacology].',
    );
    expect(cleaned).not.toMatch(/specialist findings/i);
    // Real [S#] citations and the prose are preserved; punctuation stays tidy.
    expect(cleaned).toContain('[S18]');
    expect(cleaned).toContain('disease-modifying in HFrEF [S18].');
    expect(cleaned).not.toContain('  ');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Empagliflozin reduced HF hospitalization [S3] (HR 0.75).';
    expect(stripLeakedSpecialistLabels(text)).toBe(text);
  });
});
