import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../manuscript';
import { buildPublicationArtifact } from '../publication';
import {
  buildClaimLedger,
  buildPaperBlueprint,
  extractEvidenceFromRecords,
  parseEvidenceExtractionJson,
  validatePaperPackage,
} from '../paperPipeline';

function record(partial: Partial<EvidenceItem> & { source?: EvidenceItem['source'] } = {}): EvidenceItem {
  return {
    source: 'pubmed',
    title: 'Clinical safety outcomes in anticoagulated patients',
    year: 2024,
    authors: ['A Researcher'],
    identifiers: { pmid: '12345', doi: '10.1000/test' },
    snippet:
      'A randomized clinical trial enrolled 240 patients with atrial fibrillation receiving anticoagulants and reported bleeding risk with odds ratio 1.42 and 95% CI 1.10-1.84, p=0.01.',
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: 'record-1',
    ...partial,
  };
}

describe('paper pipeline evidence extraction', () => {
  it('extracts structured sample sizes and source-backed effect statistics', () => {
    const [extraction] = extractEvidenceFromRecords([record()]);

    expect(extraction?.sourceMarker).toBe('[S1]');
    expect(extraction?.studyDesign).toBe('randomized clinical trial');
    expect(extraction?.sampleSize).toBe('n=240');
    expect(extraction?.effectValues.some((effect) => effect.label === 'odds ratio' && effect.value === '1.42')).toBe(true);
    expect(extraction?.trusted).toBe(true);
  });

  it('accepts valid structured JSON and rejects unsupported statistics', () => {
    const source = record();
    const valid = parseEvidenceExtractionJson(
      JSON.stringify({
        studyDesign: 'randomized clinical trial',
        population: '240 patients with atrial fibrillation',
        sampleSize: 'n=240',
        effectValues: [{ label: 'odds ratio', value: '1.42', sourceText: 'odds ratio 1.42' }],
        keyFinding: 'Bleeding risk was reported in anticoagulated patients.',
      }),
      source,
      0,
    );

    expect(valid.sampleSize).toBe('n=240');
    expect(() =>
      parseEvidenceExtractionJson(
        JSON.stringify({
          studyDesign: 'randomized clinical trial',
          sampleSize: 'n=9999',
          effectValues: [{ label: 'hazard ratio', value: '9.99', sourceText: 'hazard ratio 9.99' }],
          keyFinding: 'Unsupported statistic.',
        }),
        source,
        0,
      ),
    ).toThrow(/unsupported extracted statistic/i);
  });
});

describe('paper pipeline claim ledger and QA', () => {
  it('deduplicates repeated claims while preserving all source markers', () => {
    const extractions = extractEvidenceFromRecords([
      record({ provenanceHash: 'pubmed-1', identifiers: { pmid: '1' } }),
      record({ source: 'europepmc', provenanceHash: 'epmc-1', identifiers: { doi: '10.1000/test' } }),
    ]);
    const ledger = buildClaimLedger(extractions);

    expect(ledger).toHaveLength(1);
    expect(ledger[0]?.supportingSources).toEqual(['[S1]', '[S2]']);
  });

  it('downgrades honestly when effect statistics are unavailable', () => {
    const extractions = extractEvidenceFromRecords([
      record({
        identifiers: { pmid: '1' },
        provenanceHash: 'a',
        snippet: 'A clinical safety cohort described adverse outcome surveillance in 120 patients but did not report effect estimates.',
      }),
      record({
        identifiers: { pmid: '2' },
        provenanceHash: 'b',
        snippet: 'A clinical safety registry described bleeding risk signals in 80 patients without confidence intervals or p-values.',
      }),
      record({
        identifiers: { pmid: '3' },
        provenanceHash: 'c',
        snippet: 'A clinical outcome review summarized safety findings in 60 patients and noted the evidence remained indirect.',
      }),
    ]);
    const ledger = buildClaimLedger(extractions);
    const blueprint = buildPaperBlueprint('write a paper on anticoagulant safety', ledger);
    const qa = validatePaperPackage({ evidenceExtractions: extractions, claimLedger: ledger, paperBlueprint: blueprint });

    expect(qa.exportReady).toBe(true);
    expect(qa.warnings.some((warning) => warning.code === 'no-extracted-effect-statistics')).toBe(true);
    expect(qa.blockers.some((blocker) => blocker.code === 'insufficient-trusted-evidence')).toBe(false);
  });

  it('blocks unsupported or uncited clinical-results drafts', () => {
    const extractions = extractEvidenceFromRecords([
      record({ identifiers: { pmid: '1' }, provenanceHash: 'a' }),
      record({ identifiers: { pmid: '2' }, provenanceHash: 'b' }),
      record({ identifiers: { pmid: '3' }, provenanceHash: 'c' }),
    ]);
    const ledger = buildClaimLedger(extractions);
    const blueprint = buildPaperBlueprint('write a paper on anticoagulant safety', ledger);
    const manuscript: Manuscript = {
      title: blueprint.title,
      abstract: {
        background: 'Background.',
        objective: 'Objective.',
        methods: 'Methods.',
        results: 'Results.',
        conclusions: 'Conclusions.',
      },
      keywords: ['anticoagulant', 'safety'],
      sections: [
        { heading: 'Clinical Evidence and Safety Outcomes', body: ['The clinical effect was definitive without citations.'] },
      ],
    };
    const qa = validatePaperPackage({ manuscript, evidenceExtractions: extractions, claimLedger: ledger, paperBlueprint: blueprint });

    expect(qa.exportReady).toBe(false);
    expect(qa.blockers.some((blocker) => blocker.code === 'clinical-results-uncited')).toBe(true);
  });

  it('adds extraction, ledger, and numeric-statistics tables to the artifact', () => {
    const evidence = [record({ identifiers: { pmid: '1' }, provenanceHash: 'a' })];
    const extractions = extractEvidenceFromRecords(evidence);
    const ledger = buildClaimLedger(extractions);
    const blueprint = buildPaperBlueprint('write a paper on anticoagulant safety', ledger);
    const manuscript: Manuscript = {
      title: blueprint.title,
      abstract: {
        background: 'The evidence base describes anticoagulant safety [S1].',
        objective: 'To summarize source-grounded evidence [S1].',
        methods: 'The app searched guarded biomedical sources [S1].',
        results: 'Retrieved evidence was synthesized without model-invented statistics [S1].',
        conclusions: 'The draft requires expert review before use [S1].',
      },
      keywords: ['anticoagulant', 'safety'],
      sections: [
        { heading: 'Introduction', body: ['This short manuscript cites the source record [S1].'] },
        { heading: 'Clinical Evidence and Safety Outcomes', body: ['The clinical safety outcome is source-backed [S1].'] },
        { heading: 'Declarations', body: ['Automated evidence-review draft for expert review.'] },
      ],
    };
    const qa = validatePaperPackage({ manuscript, evidenceExtractions: extractions, claimLedger: ledger, paperBlueprint: blueprint });
    const artifact = buildPublicationArtifact(manuscript, evidence, {
      evidenceExtractions: extractions,
      claimLedger: ledger,
      paperBlueprint: blueprint,
      paperQa: qa,
    });

    expect(artifact.evidenceExtractions).toHaveLength(1);
    expect(artifact.claimLedger).toHaveLength(1);
    expect(artifact.tables.map((table) => table.id)).toContain('table-evidence-extraction');
    expect(artifact.tables.map((table) => table.id)).toContain('table-claim-ledger');
    expect(artifact.tables.map((table) => table.id)).toContain('table-extracted-numeric-statistics');
    expect(artifact.statistics.computedAnalyses).toContain('claim_ledger');
    expect(artifact.statistics.extractedNumericStatisticCount).toBeGreaterThan(0);
  });
});
