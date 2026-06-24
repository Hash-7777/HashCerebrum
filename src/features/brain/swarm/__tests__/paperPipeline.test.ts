import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../manuscript';
import { buildPublicationArtifact } from '../publication';
import {
  buildClaimLedger,
  buildPaperBlueprint,
  buildPaperOutline,
  extractBoundEffects,
  extractEvidenceFromRecords,
  isSubstantiveAbstract,
  keywordsFrom,
  parseEvidenceExtractionJson,
  titleTopic,
  validatePaperPackage,
} from '../paperPipeline';

describe('isSubstantiveAbstract', () => {
  it('rejects a blank or thin abstract so the manuscript never ships an empty one', () => {
    expect(
      isSubstantiveAbstract({ background: '', objective: '', methods: '', results: '', conclusions: '' }),
    ).toBe(false);
    expect(
      isSubstantiveAbstract({ background: 'x', objective: '', methods: '', results: 'y', conclusions: 'z' }),
    ).toBe(false);
  });

  it('accepts a populated abstract', () => {
    expect(
      isSubstantiveAbstract({
        background: 'Heart failure with preserved ejection fraction is common and morbid in older adults worldwide.',
        objective: 'To summarize the source-backed evidence on SGLT2 inhibitors in this population.',
        methods: 'An automated literature search retrieved and synthesized records from guarded biomedical sources.',
        results: 'The retrieved meta-analyses reported a consistent protective association across the included trials.',
        conclusions: 'The draft requires expert review before any clinical or publication use.',
      }),
    ).toBe(true);
  });
});

describe('buildPaperOutline', () => {
  const question = 'make a research paper about warfarin and NSAID bleeding risk';

  it('returns a title and a section list with one-line intents', () => {
    const outline = buildPaperOutline(question);
    expect(outline.title.length).toBeGreaterThan(0);
    expect(outline.sections.length).toBeGreaterThan(3);
    expect(outline.sections[0]!.heading).toBe('Introduction');
    expect(outline.sections[0]!.intent.length).toBeGreaterThan(0);
    expect(outline.sections.every((s) => s.intent.length <= 180)).toBe(true);
  });

  it('uses the reduced section set in mini mode', () => {
    const full = buildPaperOutline(question, false).sections.length;
    const mini = buildPaperOutline(question, true).sections.length;
    expect(mini).toBeLessThan(full);
  });
});

describe('title & keyword cleanup', () => {
  const prompt = 'make a full reaserch paper about nsaids use with warfarin and digoxin in young population with statistics';

  it('strips instruction words and the trailing statistics clause from the title topic', () => {
    const topic = titleTopic(prompt);
    expect(topic.toLowerCase()).not.toContain('reaserch');
    expect(topic.toLowerCase()).not.toContain('full');
    expect(topic.toLowerCase()).not.toMatch(/\bpaper\b/);
    expect(topic.toLowerCase()).not.toMatch(/with statistics$/);
    expect(topic.toLowerCase()).toContain('nsaids');
    expect(topic.toLowerCase()).toContain('warfarin');
  });

  it('derives keywords from the subject, never the instruction or typos', () => {
    const keywords = keywordsFrom(prompt);
    expect(keywords).not.toContain('full');
    expect(keywords).not.toContain('reaserch');
    expect(keywords).not.toContain('research');
    expect(keywords).not.toContain('paper');
    expect(keywords).not.toContain('statistics');
    expect(keywords).toEqual(expect.arrayContaining(['nsaids', 'warfarin', 'digoxin']));
  });

  it('drops trailing instruction sentences and leading publication-ready meta', () => {
    const multi =
      'Write a complete, publication-ready research paper assessing the association between SGLT2 inhibitor use and cardiovascular outcomes in HFpEF. Use full IMRaD structure with an abstract and a numbered Vancouver reference list. Compute the statistics and flag any evidence gaps honestly.';
    const topic = titleTopic(multi).toLowerCase();
    expect(topic).toContain('sglt2');
    expect(topic).not.toContain('publication');
    expect(topic).not.toContain('imrad');
    expect(topic).not.toContain('vancouver');
    expect(topic).not.toContain('flag any evidence');
    const kw = keywordsFrom(multi);
    for (const junk of ['publication', 'ready', 'assessing', 'paper', 'research']) {
      expect(kw).not.toContain(junk);
    }
    expect(kw).toContain('sglt2');
  });

  it('uses an explicit user-supplied title verbatim (no truncation)', () => {
    const full =
      'Write a full, publishable-quality research paper titled "Sodium-glucose cotransporter-2 inhibitors for heart failure across the ejection-fraction spectrum: efficacy, safety, and current consensus." Cover HFrEF, HFmrEF, and HFpEF separately.';
    expect(titleTopic(full)).toBe(
      'Sodium-glucose cotransporter-2 inhibitors for heart failure across the ejection-fraction spectrum: efficacy, safety, and current consensus',
    );
    const kw = keywordsFrom(full);
    for (const junk of ['publishable-quality', 'publishable', 'titled', 'quality', 'across']) {
      expect(kw).not.toContain(junk);
    }
    expect(kw).toEqual(expect.arrayContaining(['cotransporter-2', 'failure']));
  });

  it('drops comparison and temporal question words from keywords', () => {
    const kw = keywordsFrom(
      'For aspirin in primary prevention in older adults, how does the effect differ for ischemic versus hemorrhagic stroke, and has the consensus changed over the last decade?',
    );
    for (const junk of ['differ', 'versus', 'decade', 'consensus', 'changed', 'last', 'over']) {
      expect(kw).not.toContain(junk);
    }
    expect(kw).toContain('aspirin');
  });

  it('leaves an already-clean topic intact', () => {
    expect(titleTopic('Anticoagulation in atrial fibrillation').toLowerCase()).toContain('anticoagulation');
  });
});

describe('extractBoundEffects', () => {
  it('binds a ratio to its own CI and p-value and tags the direction', () => {
    const [e] = extractBoundEffects('Mortality fell with a hazard ratio of 0.74 (95% CI 0.65-0.85; p = 0.0008).');
    expect(e?.measure).toBe('HAZARD RATIO');
    expect(e?.value).toBe('0.74');
    expect(e?.ci).toBe('0.65-0.85');
    expect(e?.pValue).toBe('0.0008');
    expect(e?.direction).toBe('reduction');
  });

  it('marks a CI that crosses 1.0 as no effect', () => {
    const [e] = extractBoundEffects('HR 0.90 (95% CI 0.79-1.02, p = 0.08)');
    expect(e?.direction).toBe('no effect');
  });

  it('tags an increase and never glues another study’s numbers', () => {
    // Two separate estimates; each keeps only its own CI.
    const effects = extractBoundEffects('HR 1.35 (95% CI 1.10-1.66). A different review found RR 0.61 (95% CI 0.51-0.72).');
    expect(effects[0]?.measure).toBe('HR');
    expect(effects[0]?.ci).toBe('1.10-1.66');
    expect(effects[0]?.direction).toBe('increase');
    expect(effects[1]?.ci).toBe('0.51-0.72');
    expect(effects[1]?.direction).toBe('reduction');
  });

  it('rejects the lowercase English word "or" as a statistic', () => {
    expect(extractBoundEffects('aspirin or warfarin may be used')).toEqual([]);
  });

  it('reads effect sizes from the Results section, not Background', () => {
    // A prior different-drug HR sits in Background; the study's own HR is in Results.
    const labelled =
      'Background: An earlier review of drug X reported HR 1.80. Methods: We searched trials. Results: Drug Y reduced events, HR 0.74 (95% CI 0.65-0.85; p=0.001). Conclusions: Drug Y helps.';
    const effects = extractBoundEffects(labelled);
    expect(effects).toHaveLength(1);
    expect(effects[0]?.value).toBe('0.74');
    expect(effects[0]?.direction).toBe('reduction');
  });

  it('falls back to the whole text when no section labels are present', () => {
    const plain = 'The pooled hazard ratio was 0.80 (95% CI 0.74-0.86).';
    expect(extractBoundEffects(plain)[0]?.value).toBe('0.80');
  });

  it('corrects common medical typos in the topic and keywords', () => {
    expect(titleTopic('MICA gene and cardiovascual disease in type 1 diabetis').toLowerCase()).toContain(
      'cardiovascular',
    );
    const keywords = keywordsFrom('cardiovascual risk in diabetis patients');
    expect(keywords).toContain('cardiovascular');
    expect(keywords).toContain('diabetes');
    expect(keywords).not.toContain('cardiovascual');
  });
});

describe('Brain Mini blueprint', () => {
  it('builds a reduced section set that is lighter than the full pipeline', () => {
    const extractions = extractEvidenceFromRecords([
      record({ identifiers: { pmid: '1' }, provenanceHash: 'a' }),
    ]);
    const ledger = buildClaimLedger(extractions);
    const full = buildPaperBlueprint('anticoagulant safety', ledger);
    const mini = buildPaperBlueprint('anticoagulant safety', ledger, undefined, true);
    expect(mini.sections.length).toBeLessThan(full.sections.length);
    const headings = mini.sections.map((s) => s.heading);
    expect(headings).toEqual(expect.arrayContaining(['Introduction', 'Conclusion', 'Declarations']));
    // The heavy breakdown sections are dropped in Mini.
    expect(headings).not.toContain('Mechanistic and Pharmacologic Evidence');
    expect(headings).not.toContain('Clinical Evidence and Safety Outcomes');
  });
});

describe('evidence-gated blueprint sections', () => {
  it('includes the Mechanistic and Trial sections only when trusted evidence targets them', () => {
    const trialRecord = record({
      source: 'ctgov',
      identifiers: { nctId: 'NCT01234567' },
      title: 'A randomized trial of anticoagulant management',
      provenanceHash: 'trial-1',
    });
    const mechRecord = record({
      identifiers: { pmid: '999' },
      title: 'Pharmacokinetic mechanism of warfarin metabolism',
      snippet:
        'This study examined the pharmacokinetic mechanism and drug metabolism of warfarin through the CYP2C9 enzyme pathway.',
      provenanceHash: 'mech-1',
    });
    const ledger = buildClaimLedger(extractEvidenceFromRecords([trialRecord, mechRecord]));
    const headings = buildPaperBlueprint('warfarin', ledger).sections.map((s) => s.heading);
    expect(headings).toContain('Trial and Registry Evidence');
    expect(headings).toContain('Mechanistic and Pharmacologic Evidence');
  });

  it('omits the Mechanistic and Trial sections when no evidence supports them', () => {
    const plainRecord = record({
      identifiers: { pmid: '1' },
      title: 'A cross-sectional survey of patient adherence',
      snippet: 'A cross-sectional survey of 100 patients assessed adherence to prescribed therapy.',
      provenanceHash: 'plain-1',
    });
    const ledger = buildClaimLedger(extractEvidenceFromRecords([plainRecord]));
    const headings = buildPaperBlueprint('adherence', ledger).sections.map((s) => s.heading);
    expect(headings).not.toContain('Trial and Registry Evidence');
    expect(headings).not.toContain('Mechanistic and Pharmacologic Evidence');
  });
});

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

  it('does not parse the English word "or" as an odds ratio', () => {
    // The real-run misparse: "stroke or 150 events" became "odds ratio 150".
    const [extraction] = extractEvidenceFromRecords([
      record({
        snippet: 'Patients had a stroke or 150 events during follow-up; mortality or = 65 was noted.',
      }),
    ]);
    expect(extraction?.effectValues.some((e) => e.label === 'odds ratio')).toBe(false);
  });

  it('rejects implausible integer ratios but keeps decimal ratios', () => {
    const [extraction] = extractEvidenceFromRecords([
      record({
        snippet: 'The analysis reported OR 150 for one comparison and HR 3.75 for another endpoint.',
      }),
    ]);
    const labels = extraction?.effectValues ?? [];
    expect(labels.some((e) => e.label === 'odds ratio' && e.value === '150')).toBe(false);
    expect(labels.some((e) => e.label === 'hazard ratio' && e.value === '3.75')).toBe(true);
  });

  it('drops a reversed or degenerate confidence interval', () => {
    const [extraction] = extractEvidenceFromRecords([
      record({ snippet: 'The estimate had 95% CI 1.84-1.10 reported in the abstract.' }),
    ]);
    expect(extraction?.effectValues.some((e) => e.label === 'confidence interval')).toBe(false);
  });

  it('still extracts a valid hazard ratio with a proper CI', () => {
    const [extraction] = extractEvidenceFromRecords([
      record({ snippet: 'Heart failure risk was lower with HR = 0.80 (95% CI 0.74-0.86).' }),
    ]);
    const values = extraction?.effectValues ?? [];
    expect(values.some((e) => e.label === 'hazard ratio' && e.value === '0.80')).toBe(true);
    expect(values.some((e) => e.label === 'confidence interval' && e.value === '0.74-0.86')).toBe(true);
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
      record({
        identifiers: { pmid: '4' },
        provenanceHash: 'd',
        snippet: 'A clinical cohort followed 150 patients and described adverse event monitoring without reporting effect sizes.',
      }),
      record({
        identifiers: { pmid: '5' },
        provenanceHash: 'e',
        snippet: 'A clinical safety analysis summarized outcomes in 95 patients and noted the evidence base remained indirect.',
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
    // The structured per-record extraction and raw numeric-statistics tables are
    // kept out of the publishable body (worksheet-like); the claim ledger stays.
    expect(artifact.tables.map((table) => table.id)).not.toContain('table-evidence-extraction');
    expect(artifact.tables.map((table) => table.id)).not.toContain('table-extracted-numeric-statistics');
    expect(artifact.tables.map((table) => table.id)).toContain('table-claim-ledger');
    expect(artifact.statistics.computedAnalyses).toContain('claim_ledger');
    expect(artifact.statistics.extractedNumericStatisticCount).toBeGreaterThan(0);
  });
});
