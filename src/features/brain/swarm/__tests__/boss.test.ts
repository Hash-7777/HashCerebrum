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
  pruneIrrelevantGenetics,
  stripLeakedSpecialistLabels,
  unverifiedDrugNames,
} from '../boss';
import type { BossPlan } from '../boss';
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
    // "zynteprazole" is not in RxNorm but is spelled like a drug, so it is still a
    // candidate and will be surfaced as unverifiable.
    expect(drugCandidates('zynteprazole and warfarin')).toEqual(
      expect.arrayContaining(['zynteprazole', 'warfarin']),
    );
    expect(drugCandidates('warfarin and ibuprofen')).not.toContain('and');
  });

  it('does not treat ordinary medical prose as drug names', () => {
    // The clopidogrel run reported "cyp2c19, confirmed, metabolizers, thrombosis,
    // verdict…" as drugs it could not verify, hiding the one fabricated name.
    const drugs = drugCandidates(
      'Grade the interaction between clopidogril and omeprazole in CYP2C19 poor metabolizers, ' +
        'given the confirmed three-fold rise in stent thrombosis. Include esomeprazolam in the comparison.',
    );
    expect(drugs).toEqual(expect.arrayContaining(['clopidogrel', 'omeprazole', 'esomeprazolam']));
    for (const noise of ['cyp2c19', 'confirmed', 'metabolizers', 'thrombosis', 'verdict', 'stent', 'comparison']) {
      expect(drugs).not.toContain(noise);
    }
  });

  it('normalises a misspelled drug to its real name', () => {
    expect(drugCandidates('clopidogril and omeprazole')).toEqual(
      expect.arrayContaining(['clopidogrel', 'omeprazole']),
    );
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
    expect(unverifiedDrugNames('zynteprazole and warfarin', evidence)).toEqual(['zynteprazole']);
  });

  it('flags only the fabricated drug, not the surrounding prose', () => {
    const evidence = [rec('Clopidogrel and omeprazole: CYP2C19 interaction', 'clopidogrel omeprazole stent thrombosis')];
    expect(
      unverifiedDrugNames(
        'Grade the interaction between clopidogril and omeprazole in CYP2C19 poor metabolizers. Include esomeprazolam.',
        evidence,
      ),
    ).toEqual(['esomeprazolam']);
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

  it('flags a refusal written with typographic apostrophes', () => {
    // What the provider actually returned on the HFpEF run. The straight-quote
    // regex missed it, so the refusal was rendered as a scored, cited report.
    for (const t of [
      'I’m sorry, but I can’t fulfill that request.',
      'I’m sorry, but I can’t help with that.',
      'I can’t assist with that.',
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

describe('pruneIrrelevantGenetics', () => {
  const withGenetics: BossPlan = {
    mode: 'research',
    tasks: [
      { agentId: 'evidence_synthesis', subQuery: 'q' },
      { agentId: 'genetics', subQuery: 'investigate genetic factors' },
    ],
  };

  it('drops a genetics task when the question has no genetic angle (the SGLT2 run)', () => {
    const out = pruneIrrelevantGenetics(
      withGenetics,
      'compare SGLT2 inhibitors versus GLP-1 receptor agonists for MACE in type 2 diabetes and CKD',
    );
    expect(out.tasks.some((t) => t.agentId === 'genetics')).toBe(false);
    expect(out.tasks.some((t) => t.agentId === 'evidence_synthesis')).toBe(true);
  });

  it('keeps genetics when the question is genuinely genetic (APOE, the lecanemab run)', () => {
    const out = pruneIrrelevantGenetics(
      withGenetics,
      'compare lecanemab versus donanemab, including outcomes by APOE ε4 status',
    );
    expect(out.tasks.some((t) => t.agentId === 'genetics')).toBe(true);
  });

  it('never leaves an empty research plan if genetics was the only task', () => {
    const out = pruneIrrelevantGenetics(
      { mode: 'research', tasks: [{ agentId: 'genetics', subQuery: 'g' }] },
      'a purely pharmacologic question about statins',
    );
    expect(out.tasks).toHaveLength(1);
    expect(out.tasks[0]!.agentId).toBe('evidence_synthesis');
  });

  it('leaves a chat plan untouched', () => {
    const chat: BossPlan = { mode: 'chat', tasks: [] };
    expect(pruneIrrelevantGenetics(chat, 'hello')).toEqual(chat);
  });
});
