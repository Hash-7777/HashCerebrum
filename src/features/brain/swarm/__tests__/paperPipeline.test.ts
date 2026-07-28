import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../manuscript';
import { buildPublicationArtifact } from '../publication';
import {
  buildMethodsSection,
  buildPaperBlueprint,
  buildPaperOutline,
  buildSectionUserPrompt,
  isCallBillingDead,
  isCallRateLimited,
  isSubstantiveAbstract,
  keywordsFrom,
  modelForSection,
  searchDatePhrase,
  neutralizeUnverifiableNct,
  parseRetryAfterMs,
  shouldExpandSection,
  stripUnapprovedMarkers,
  titleTopic,
  validatePaperPackage,
} from '../paperPipeline';
import { extractBoundEffects } from '../effectExtraction';
import {
  buildClaimLedger,
  extractEvidenceFromRecords,
  parseEvidenceExtractionJson,
} from '../evidenceExtraction';
import { neutralizeMisattributedGeneStatistics } from '../statisticVerification';

describe('modelForSection', () => {
  const specialists = [
    { agentId: 'pharmacist' as const, label: 'P', subQuery: '', findings: '', evidence: [], toolCalls: 0, model: 'm-pharm' },
    { agentId: 'clinical_research' as const, label: 'C', subQuery: '', findings: '', evidence: [], toolCalls: 0, model: 'm-clin' },
    { agentId: 'evidence_synthesis' as const, label: 'E', subQuery: '', findings: '', evidence: [], toolCalls: 0, model: 'm-eviz' },
  ];
  it('drafts a body section on its owning specialist model', () => {
    expect(modelForSection('Mechanistic and Pharmacologic Evidence', specialists, 'boss')).toBe('m-pharm');
    expect(modelForSection('Clinical Evidence and Safety Outcomes', specialists, 'boss')).toBe('m-clin');
    expect(modelForSection('Evidence Base and Search Yield', specialists, 'boss')).toBe('m-eviz');
  });
  it('keeps connective sections and unknown owners on the boss model', () => {
    expect(modelForSection('Introduction', specialists, 'boss')).toBe('boss');
    expect(modelForSection('Discussion', specialists, 'boss')).toBe('boss');
    expect(modelForSection('Clinical Evidence', [], 'boss')).toBe('boss');
  });
});

describe('stripUnapprovedMarkers', () => {
  const approved = new Set(['[S1]', '[S2]', '[S3]']);
  it('drops markers beyond the approved claim ledger, keeps approved ones', () => {
    const out = stripUnapprovedMarkers(
      [{ heading: 'Intro', body: ['A finding [S2] and an over-cited one [S79] here.'] }],
      approved,
    );
    expect(out[0]!.body[0]).toBe('A finding [S2] and an over-cited one here.');
  });

  it('leaves a fully-approved section untouched', () => {
    const body = ['Point one [S1]. Point two [S3].'];
    const out = stripUnapprovedMarkers([{ heading: 'X', body }], approved);
    expect(out[0]!.body[0]).toBe('Point one [S1]. Point two [S3].');
  });

  it('tidies punctuation when a trailing marker is removed', () => {
    const out = stripUnapprovedMarkers([{ heading: 'X', body: ['Claim [S95].'] }], approved);
    expect(out[0]!.body[0]).toBe('Claim.');
  });
});

describe('neutralizeUnverifiableNct', () => {
  it('strips a hallucinated NCT and its registered-as scaffolding, keeping the prose', () => {
    const out = neutralizeUnverifiableNct(
      'The completed clinical trial registered as NCT03596502 compared DOACs versus warfarin.',
      ['NCT03596502'],
    );
    expect(out).not.toContain('NCT03596502');
    expect(out).toContain('compared DOACs versus warfarin');
    expect(out).toContain('a registered trial');
  });

  it('drops a parenthetical NCT and tidies punctuation', () => {
    const out = neutralizeUnverifiableNct('An observational study (NCT03993119) tracked usage.', ['NCT03993119']);
    expect(out).toBe('An observational study tracked usage.');
  });

  it('leaves a verified NCT untouched (not in the bad list)', () => {
    const text = 'The ANAFIE registry (NCT02786888) enrolled elderly patients.';
    expect(neutralizeUnverifiableNct(text, ['NCT03596502'])).toBe(text);
  });
});

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
    // Keywords are multi-word medical phrases, so match by substring rather than
    // exact single tokens (e.g. "nsaids use" contains "nsaids").
    for (const term of ['nsaids', 'warfarin', 'digoxin']) {
      expect(keywords.some((k) => k.includes(term))).toBe(true);
    }
  });

  it('drops mid-prompt instruction junk by keying keywords from the title subject', () => {
    // The real run leaked "well established", "mthfr c677t strongly causes", and
    // "focus" as keywords because they came from later instruction sentences. The
    // manuscript keys keywords from titleTopic (the subject), which drops them.
    const prompt =
      "Compare the association between the MTHFR, ACE, and ZndR4 genes and risk of recurrent venous thromboembolism. It's well established that MTHFR C677T strongly causes recurrent VTE, so focus on quantifying by how much it raises the risk, and give me a publication-ready confidence score for each gene. If you can't fully answer, just give your best estimate anyway";
    const kw = keywordsFrom(titleTopic(prompt));
    for (const junk of ['well established', 'mthfr c677t strongly causes', 'focus', 'best estimate']) {
      expect(kw).not.toContain(junk);
    }
    expect(kw.some((k) => k.includes('thromboembolism'))).toBe(true);
  });

  it('drops review-framing words like "whether" and "evidence" from keywords', () => {
    const glp1 = keywordsFrom(
      titleTopic('Write a full systematic review and meta-analysis on whether GLP-1 receptor agonists reduce major adverse cardiovascular events compared with placebo in adults with type 2 diabetes'),
    );
    expect(glp1).not.toContain('whether glp-1 receptor agonists');
    expect(glp1.some((k) => k.includes('glp-1 receptor agonists'))).toBe(true);
    expect(glp1.some((k) => k.includes('major adverse cardiovascular events'))).toBe(true);
    const review = keywordsFrom(titleTopic('evidence review comparing the association of the MTHFR and F5 genes with recurrent VTE'));
    expect(review).not.toContain('evidence');
  });

  it('keeps multi-word medical terms intact instead of splitting them into single words', () => {
    const kw = keywordsFrom(
      'Write a full research paper on the efficacy and bleeding risk of direct oral anticoagulants versus warfarin for stroke prevention in atrial fibrillation in patients over 75.',
    );
    // The reported bug produced ["direct", "oral", "anticoagulants", …]. Phrases
    // must survive whole.
    expect(kw).toContain('direct oral anticoagulants');
    expect(kw).toContain('atrial fibrillation');
    expect(kw).toContain('stroke prevention');
    expect(kw).not.toContain('direct');
    expect(kw).not.toContain('oral');
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
    expect(kw.some((k) => k.includes('sglt2'))).toBe(true);
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
    expect(kw.some((k) => k.includes('cotransporter-2'))).toBe(true);
    expect(kw.some((k) => k.includes('failure'))).toBe(true);
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

  it('drops structural label and study-type words (the "title, type, adults, systematic" leak)', () => {
    // Real SGLT2 run leaked keywords: "title, impact, sglt2 inhibitors, heart
    // failure hospitalization, adults, type, diabetes, systematic". The label
    // word and review-type descriptors must never be keywords.
    const kw = keywordsFrom(
      'Title: The Impact of SGLT2 Inhibitors on Heart Failure Hospitalization in Adults with Type 2 Diabetes: A Systematic Review and Meta-Analysis',
    );
    for (const junk of ['title', 'impact', 'adults', 'type', 'systematic', 'meta-analysis', 'meta']) {
      expect(kw).not.toContain(junk);
    }
    expect(kw.some((k) => k.includes('sglt2'))).toBe(true);
    expect(kw.some((k) => k.includes('heart failure'))).toBe(true);
  });

  describe('buildMethodsSection (deterministic Methods)', () => {
    const wordCount = (body: string[]) =>
      body.join(' ').split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

    const evi = (source: string) => ({
      source: source as 'pubmed',
      title: `Record from ${source}`,
      year: 2024,
      authors: ['A Researcher'],
      identifiers: {},
      snippet: 's',
      fetchedAt: new Date(0).toISOString(),
      provenanceHash: `h-${source}-${Math.random()}`,
    });
    const ext = (marker: string, source: string, design: string, outcomes: string[], keyFinding: string) => ({
      id: marker,
      sourceMarker: marker,
      evidenceIndex: 0,
      source: source as 'pubmed',
      title: `Study ${marker}`,
      year: '2024',
      identifiers: {},
      studyDesign: design,
      population: 'adults with type 2 diabetes',
      exposureOrIntervention: 'SGLT2 inhibitor',
      comparator: 'placebo',
      outcomes,
      sampleSize: 'n=1000',
      effectValues: [{ label: 'finding', value: '', sourceText: '' }],
      limitations: [],
      keyFinding,
      trusted: true,
    });

    // A review WITH two comparable hazard ratios (a pooled meta-analysis is real).
    const sglt2Q = 'Write a paper on whether SGLT2 inhibitors reduce heart failure hospitalization in type 2 diabetes';
    const sglt2Evidence = [evi('pubmed'), evi('pubmed'), evi('europepmc')];
    const sglt2Extractions = [
      ext('[S1]', 'pubmed', 'randomized controlled trial', ['heart failure hospitalization'], 'hazard ratio 0.80 (95% CI 0.74-0.86)'),
      // A meta-analysis estimate is excluded from the app's own pool (re-pooling it
      // would double-count the trials it already summarised).
      ext('[S2]', 'europepmc', 'systematic review and meta-analysis', ['cardiovascular death'], 'hazard ratio 0.76 (95% CI 0.72-0.81)'),
      // Two PRIMARY studies (the RCT above and this cohort) carry comparable, same-
      // direction hazard ratios, so the app pools these — not the review.
      ext('[S3]', 'pubmed', 'cohort study', ['heart failure hospitalization'], 'hazard ratio 0.83 (95% CI 0.71-0.97)'),
    ];
    // A DIFFERENT review, minimal evidence, no poolable effects (narrative only).
    const warfarinQ = 'Write a paper on warfarin and NSAID bleeding risk in older adults';
    const warfarinEvidence = [evi('pubmed')];
    const warfarinExtractions = [ext('[S1]', 'pubmed', 'cross-sectional study', ['gastrointestinal bleeding'], 'no confidence interval reported')];

    it('clears the 500-word minimum even on minimal evidence, without a model call', () => {
      expect(wordCount(buildMethodsSection(warfarinQ, warfarinEvidence, warfarinExtractions))).toBeGreaterThanOrEqual(500);
    });

    it('reflects THIS study — its topic, the databases that contributed, the design mix, the outcomes', () => {
      const text = buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions).join(' ');
      expect(text.toLowerCase()).toContain('sglt2'); // the actual topic
      expect(text).toContain('PubMed/MEDLINE (2)'); // real source + count
      expect(text).toContain('Europe PMC (1)');
      expect(text).toContain('3 record(s)'); // real retrieved count
      expect(text).toMatch(/randomised controlled trial/); // real design mix
      expect(text).toContain('heart failure hospitalization'); // real outcome tracked
    });

    it('is NOT a fixed template — two different reviews produce different Methods', () => {
      const a = buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions).join(' ');
      const b = buildMethodsSection(warfarinQ, warfarinEvidence, warfarinExtractions).join(' ');
      expect(a).not.toEqual(b);
      expect(a.toLowerCase()).toContain('sglt2');
      expect(b.toLowerCase()).toContain('warfarin');
      expect(b).not.toContain('PubMed/MEDLINE (2)'); // warfarin had 1 pubmed record
    });

    describe('searchDatePhrase', () => {
      const dated = (day: string) => ({ ...evi('pubmed'), fetchedAt: `${day}T09:00:00.000Z` });

      it('stamps the single retrieval date read from the records', () => {
        expect(searchDatePhrase([dated('2026-07-14')])).toBe(', searched on 2026-07-14');
      });

      it('reports a date range when records were fetched on different days', () => {
        expect(searchDatePhrase([dated('2026-07-10'), dated('2026-07-14')])).toBe(
          ', searched between 2026-07-10 and 2026-07-14',
        );
      });

      it('never fabricates a date when no record carries a usable timestamp', () => {
        expect(searchDatePhrase([{ ...evi('pubmed'), fetchedAt: '' }])).toBe('');
      });

      it('is surfaced in the Methods section', () => {
        const text = buildMethodsSection(sglt2Q, [dated('2026-07-14')], sglt2Extractions).join(' ');
        expect(text).toContain('searched on 2026-07-14');
      });
    });

    it('states a real pooled meta-analysis only when the evidence supports it', () => {
      const pooled = buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions).join(' ');
      expect(pooled).toContain('DerSimonian');
      expect(pooled).toMatch(/pooled estimate and forest plot appear/);

      const narrative = buildMethodsSection(warfarinQ, warfarinEvidence, warfarinExtractions).join(' ');
      expect(narrative).toMatch(/did not report enough comparable effect measures/);
      expect(narrative).not.toContain('DerSimonian');
    });

    it('stays honest — no drift, no domain split, competitors only named as NOT searched', () => {
      const text = buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions).join(' ');
      expect(text).toMatch(/rather than a hand-curated systematic review/i);
      expect(text).toMatch(/no GRADE certainty|no formal risk-of-bias/i);
      expect(text.toLowerCase()).not.toContain('in conclusion');
      expect(text).toContain('ClinicalTrials.gov');
      expect(text).not.toContain('ClinicalTrials. gov');
      expect(text).toMatch(/Embase, Scopus/);
      expect(text).not.toMatch(/searched\s+Embase|queried\s+Scopus/i);
    });

    it('appends an evidence-gap note only when supplied, and is deterministic', () => {
      const gap = 'The retrieved records contain NO direct evidence for: pediatric dosing.';
      const withGap = buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions, gap);
      expect(withGap[withGap.length - 1]).toBe(gap);
      expect(buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions)).not.toContain(gap);
      // Same inputs → identical output.
      expect(buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions)).toEqual(
        buildMethodsSection(sglt2Q, sglt2Evidence, sglt2Extractions),
      );
    });
  });

  it('leaves an already-clean topic intact', () => {
    expect(titleTopic('Anticoagulation in atrial fibrillation').toLowerCase()).toContain('anticoagulation');
  });

  it('drops gerund/meta and statistical-descriptor words (the lecanemab run)', () => {
    const kw = keywordsFrom(
      "Write a full, publishable research paper, with statistics, comparing lecanemab versus donanemab for slowing cognitive decline in early symptomatic Alzheimer's disease. Report the effect sizes (CDR-SB change), confidence intervals, and p-values, weigh the risk of ARIA, including by APOE ε4 status.",
    );
    // Real subject terms survive…
    expect(kw.some((k) => k.includes('lecanemab'))).toBe(true);
    expect(kw.some((k) => k.includes('donanemab'))).toBe(true);
    expect(kw.some((k) => k.includes('cognitive decline'))).toBe(true);
    // "Alzheimer's disease" is not shattered by the possessive.
    expect(kw.some((k) => k.includes('alzheimer disease'))).toBe(true);
    // …while the junk from the real run is gone.
    for (const junk of ['comparing', 'slowing', 'weigh', 'p-values', 'effect', 'sizes', 'confidence', 'intervals', 'disease']) {
      expect(kw).not.toContain(junk);
    }
    expect(kw.some((k) => k === 'effect sizes' || k.startsWith('effect '))).toBe(false);
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

  it('drops a CI that does not bracket its own point estimate (a misparse)', () => {
    // The real garbled pair: "OR 2.08 (95% CI 2.88 to 3.77)" — 2.08 is below the
    // interval, so the CI belongs to a different number and must not be kept or pooled.
    const [e] = extractBoundEffects('The endpoint had an odds ratio of 2.08 (95% CI 2.88 to 3.77).');
    expect(e?.value).toBe('2.08');
    expect(e?.ci).toBeNull();
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
    expect(keywords.some((k) => k.includes('cardiovascular'))).toBe(true);
    expect(keywords.some((k) => k.includes('diabetes'))).toBe(true);
    expect(keywords.join(' ')).not.toContain('cardiovascual');
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

describe('neutralizeMisattributedGeneStatistics', () => {
  const question =
    'Compare the association between the MTHFR and ACE genes and risk of recurrent venous thromboembolism';
  // MTHFR is discussed but its sources report NO effect estimate; the only ratio
  // in the corpus (RR 15.2) comes from a factor-V mortality study that never
  // mentions MTHFR — the exact shape of the real misattribution.
  const evidence: EvidenceItem[] = [
    record({
      identifiers: { pmid: '7', gene: 'MTHFR' },
      title: 'Hyperhomocysteinemia and the MTHFR C677T mutation: a case report',
      snippet: 'A patient with the MTHFR C677T variant had recurrent thrombosis; no comparative effect estimate was reported.',
      provenanceHash: 'mthfr-1',
    }),
    record({
      identifiers: { pmid: '2' },
      title: 'Prothrombin and factor V mutations in pregnancy-related thrombosis',
      snippet: 'Among carriers, the relative risk of 15.2 for mortality was observed for factor V and prothrombin variants.',
      provenanceHash: 'fv-1',
    }),
    record({
      identifiers: { pmid: '6', gene: 'ACE' },
      title: 'ACE insertion/deletion polymorphism and venous thromboembolism',
      snippet: 'The ACE I/D polymorphism was studied in 148 participants with odds ratio 0.53, p=0.04.',
      provenanceHash: 'ace-1',
    }),
  ];

  it('strips a ratio pinned to a gene that gene’s own sources never report', () => {
    const drafted =
      'The MTHFR variant showed a relative risk of 15.2 for recurrence. The ACE polymorphism had an odds ratio 0.53.';
    const { text, removed } = neutralizeMisattributedGeneStatistics(drafted, question, evidence);
    expect(removed.some((r) => r.includes('15.2'))).toBe(true);
    expect(text).not.toContain('15.2');
    // The supported ACE odds ratio, and the MTHFR claim in words, are kept.
    expect(text).toContain('odds ratio 0.53');
    expect(text).toContain('MTHFR variant');
  });

  it('keeps a ratio a gene’s own source does report', () => {
    const drafted = 'The ACE polymorphism carried an odds ratio 0.53 for recurrent VTE.';
    const { text, removed } = neutralizeMisattributedGeneStatistics(drafted, question, evidence);
    expect(removed).toEqual([]);
    expect(text).toBe(drafted);
  });

  it('never judges a sentence naming two query genes at once', () => {
    const drafted = 'Both MTHFR and ACE carried a hazard ratio 9.9 in the pooled set.';
    const { text } = neutralizeMisattributedGeneStatistics(drafted, question, evidence);
    expect(text).toBe(drafted);
  });

  it('is a no-op when the question names no gene', () => {
    const drafted = 'Warfarin carried an odds ratio 15.2 for bleeding.';
    const { text, removed } = neutralizeMisattributedGeneStatistics(
      drafted,
      'compare warfarin and apixaban for bleeding',
      evidence,
    );
    expect(removed).toEqual([]);
    expect(text).toBe(drafted);
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
    // Only data tables are published now: the worksheet-like extraction tables and
    // the internal claim-ledger table are omitted; the study-characteristics table
    // stays. The claim ledger still drives the synthesis (computedAnalyses below).
    expect(artifact.tables.map((table) => table.id)).not.toContain('table-evidence-extraction');
    expect(artifact.tables.map((table) => table.id)).not.toContain('table-extracted-numeric-statistics');
    expect(artifact.tables.map((table) => table.id)).not.toContain('table-claim-ledger');
    expect(artifact.tables.map((table) => table.id)).toContain('table-study-characteristics');
    expect(artifact.statistics.computedAnalyses).toContain('claim_ledger');
    expect(artifact.statistics.extractedNumericStatisticCount).toBeGreaterThan(0);
  });
});

describe('buildSectionUserPrompt (free-tier prompt budget)', () => {
  const section = {
    heading: 'Clinical Evidence and Safety Outcomes',
    intent: 'Present the clinical evidence.',
    requiredClaimIds: [],
    requiredSourceMarkers: [],
    targetWords: '900–1200 words',
    minWords: 750,
  };

  const extraction = (i: number) => ({
    id: `s${i}`,
    sourceMarker: `[S${i}]`,
    evidenceIndex: i,
    source: 'pubmed' as const,
    title: `A reasonably long study title number ${i} about the intervention and its measured cardiovascular outcomes`,
    year: '2024',
    identifiers: { pmid: `${1000000 + i}`, doi: `10.1000/study.${i}` },
    studyDesign: 'randomized clinical trial',
    population: 'adults with type 2 diabetes and established cardiovascular disease',
    exposureOrIntervention: 'an SGLT2 inhibitor at the standard licensed dose',
    comparator: 'placebo added to guideline-directed therapy',
    outcomes: ['heart failure hospitalization', 'cardiovascular death'],
    sampleSize: 'n=4000',
    effectValues: [{ label: 'hazard ratio', value: '0.79', sourceText: 'HR 0.79 (95% CI 0.69-0.89)' }],
    limitations: ['open-label extension', 'industry funded'],
    keyFinding: `Study ${i} reported a reduction in heart failure hospitalization with the intervention versus placebo`,
    trusted: true,
  });

  // 40 relevant extractions — the uncapped block would be well over the budget.
  const extractions = Array.from({ length: 40 }, (_, i) => extraction(i + 1));
  const claims = extractions.slice(0, 12).map((e, i) => ({
    id: `c${i}`,
    claim: `Claim ${i}: the intervention reduced heart failure hospitalization`,
    supportingSources: [e.sourceMarker],
    sectionTarget: section.heading,
    evidenceStrength: 'strong' as const,
    contradictionNotes: [],
    numericSupport: [],
  }));

  it('keeps the section prompt within a small-model budget even with many records', () => {
    const prompt = buildSectionUserPrompt({
      question: 'Do SGLT2 inhibitors reduce heart failure hospitalization in type 2 diabetes?',
      section,
      claims,
      extractions,
      specialistDigest: 'x'.repeat(4000),
      datasetBlock: '(no uploaded dataset was supplied)',
      priorDigest: 'y'.repeat(4000),
    });
    // Fits comfortably in an ~8k-token context with room for a 5.8k-token reply.
    expect(prompt.length).toBeLessThan(12_000);
    // The claim ledger (the instruction) is preserved in full.
    expect(prompt).toContain('Claim 0:');
    expect(prompt).toContain('Claim 11:');
    // At least the top extraction survives, and the rest are acknowledged.
    expect(prompt).toContain('[S1]');
    expect(prompt).toMatch(/\+\d+ further retrieved record/);
    // The trimmed digests do not blow the budget.
    expect(prompt).not.toContain('y'.repeat(2000));
  });

  it('does not truncate when the corpus is small (no spurious "further records" note)', () => {
    const prompt = buildSectionUserPrompt({
      question: 'Q',
      section,
      claims: claims.slice(0, 2),
      extractions: extractions.slice(0, 2),
      specialistDigest: 'agents',
      datasetBlock: '(none)',
      priorDigest: 'prior',
    });
    expect(prompt).not.toMatch(/further retrieved record/);
    expect(prompt).toContain('[S1]');
    expect(prompt).toContain('[S2]');
  });
});

describe('isCallBillingDead vs isCallRateLimited', () => {
  it('treats a free-tier 429 that mentions "billing details" as rate-limited, not dead', () => {
    // Gemini's real free-tier 429 body. It contains the word "billing", which a
    // bare-substring billing check misread as a permanent out-of-credits death and
    // aborted the whole section. It must be classified as a transient rate-limit so
    // the pipeline waits and retries instead of shipping an incomplete draft.
    const gemini429 = new Error(
      'gemini HTTP 429: {"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details."}}',
    );
    expect(isCallRateLimited(gemini429)).toBe(true);
    expect(isCallBillingDead(gemini429)).toBe(false);
  });

  it('still treats a genuine 402 / insufficient-credits error as billing-dead', () => {
    expect(isCallBillingDead(new Error('HTTP 402: insufficient credits for this request'))).toBe(true);
    expect(isCallBillingDead(new Error('payment required'))).toBe(true);
  });

  it('does not treat an ordinary rate limit as billing-dead', () => {
    expect(isCallBillingDead(new Error('groq HTTP 429: rate limit reached'))).toBe(false);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads the real provider cooldown phrasings', () => {
    // Groq
    expect(parseRetryAfterMs(new Error('Rate limit reached. Please try again in 8.522s'))).toBe(8522);
    expect(parseRetryAfterMs(new Error('try again in 2m30s'))).toBe(150_000);
    // Gemini
    expect(parseRetryAfterMs(new Error('You exceeded your quota. "retryDelay": "12s"'))).toBe(12_000);
    expect(parseRetryAfterMs(new Error('Please retry after 30 seconds'))).toBe(30_000);
    // OpenAI-style header echoed into the message
    expect(parseRetryAfterMs(new Error('Retry-After: 20'))).toBe(20_000);
    // Milliseconds
    expect(parseRetryAfterMs(new Error('retry in 500ms'))).toBe(500);
  });

  it('returns undefined when no delay is advertised, so the caller uses backoff', () => {
    expect(parseRetryAfterMs(new Error('provider cooling down from a recent rate limit'))).toBeUndefined();
    expect(parseRetryAfterMs(new Error('429 Too Many Requests'))).toBeUndefined();
  });

  it('never mistakes an unrelated number (e.g. an odds ratio) for a delay', () => {
    expect(
      parseRetryAfterMs(new Error('Rate limit reached while reporting odds ratio 0.79s effect')),
    ).toBeUndefined();
  });
});

describe('shouldExpandSection', () => {
  it('expands only a materially short section (< 85% of the minimum)', () => {
    expect(shouldExpandSection(600, 750, false)).toBe(true); // 80% — worth a call
    expect(shouldExpandSection(640, 750, false)).toBe(false); // 85% — good enough
    expect(shouldExpandSection(750, 750, false)).toBe(false); // at minimum
    expect(shouldExpandSection(900, 750, false)).toBe(false); // over minimum
  });

  it('never expands once the run has been rate-limited, however short', () => {
    // Ship the clean shorter draft rather than burn quota to pad it.
    expect(shouldExpandSection(100, 750, true)).toBe(false);
    expect(shouldExpandSection(600, 750, true)).toBe(false);
  });
});
