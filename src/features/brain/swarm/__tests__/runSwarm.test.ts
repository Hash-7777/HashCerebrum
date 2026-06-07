import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  assessEvidenceSufficiency,
  conceptCoverage,
  conceptGroups,
  evidenceScore,
  isNonCitableProceeding,
  mergeEvidence,
  rankEvidenceByRelevance,
} from '../runSwarm';
import type { SpecialistResult } from '../types';

function makeRecord(partial: Partial<EvidenceItem> & { source: EvidenceItem['source'] }): EvidenceItem {
  return {
    title: 'Test record',
    authors: ['Test'],
    identifiers: {},
    fetchedAt: new Date().toISOString(),
    provenanceHash: 'test',
    ...partial,
  };
}

function makeSpecialist(evidence: EvidenceItem[]): SpecialistResult {
  return {
    agentId: 'literature',
    label: 'Literature',
    subQuery: 'test',
    findings: '',
    evidence,
    toolCalls: 0,
  };
}

describe('evidenceScore', () => {
  it('scores ctgov higher than openalex', () => {
    const ctgov = makeRecord({ source: 'ctgov', year: 2020 });
    const openalex = makeRecord({ source: 'openalex', year: 2020 });
    expect(evidenceScore(ctgov)).toBeGreaterThan(evidenceScore(openalex));
  });

  it('rewards recency up to a cap', () => {
    const oldRecord = makeRecord({ source: 'pubmed', year: 2010 });
    const newRecord = makeRecord({ source: 'pubmed', year: 2026 });
    expect(evidenceScore(newRecord)).toBeGreaterThan(evidenceScore(oldRecord));
  });

  it('rewards url and snippet presence', () => {
    const minimal = makeRecord({ source: 'pubmed', year: 2020 });
    const rich = makeRecord({ source: 'pubmed', year: 2020, url: 'https://example.com', snippet: 'A detailed snippet that explains the findings.' });
    expect(evidenceScore(rich)).toBeGreaterThan(evidenceScore(minimal));
  });
});

describe('mergeEvidence', () => {
  it('deduplicates by key', () => {
    const record = makeRecord({ source: 'pubmed', year: 2020, identifiers: { pmid: '123' } });
    const specialists = [makeSpecialist([record, record])];
    const merged = mergeEvidence(specialists);
    expect(merged).toHaveLength(1);
  });

  it('ranks higher-quality evidence first', () => {
    const low = makeRecord({ source: 'rxnorm', year: 2010 });
    const high = makeRecord({ source: 'ctgov', year: 2026, url: 'https://example.com', snippet: 'Detailed findings here.' });
    const specialists = [makeSpecialist([low, high])];
    const merged = mergeEvidence(specialists);
    expect(merged[0]).toBe(high);
    expect(merged[1]).toBe(low);
  });

  it('merges evidence from multiple specialists', () => {
    const s1 = makeSpecialist([makeRecord({ source: 'pubmed', year: 2020, identifiers: { pmid: '1' } })]);
    const s2 = makeSpecialist([makeRecord({ source: 'ctgov', year: 2020, identifiers: { pmid: '2' } })]);
    const merged = mergeEvidence([s1, s2]);
    expect(merged).toHaveLength(2);
  });

  it('drops conference-proceeding and abstract-collection records', () => {
    const titled = (title: string) => makeRecord({ source: 'europepmc', title });
    expect(isNonCitableProceeding(titled('ESICM LIVES 2024. Barcelona, Spain.'))).toBe(true);
    expect(isNonCitableProceeding(titled('UEG Week 2025 Moderated Posters'))).toBe(true);
    expect(isNonCitableProceeding(titled('E-Posters'))).toBe(true);
    expect(isNonCitableProceeding(titled('Book of Posters'))).toBe(true);
    expect(
      isNonCitableProceeding(titled('Abstracts from the 2020 Annual Meeting of the Society of General Internal Medicine')),
    ).toBe(true);
    // A real study title is kept.
    expect(
      isNonCitableProceeding(titled('Antimicrobial stewardship interventions in adults with hospital-acquired pneumonia')),
    ).toBe(false);

    const real = makeRecord({ source: 'pubmed', title: 'Bleeding risk in anticoagulated patients', identifiers: { pmid: '1' } });
    const poster = makeRecord({ source: 'europepmc', title: 'UEG Week 2024 Poster Presentations', identifiers: { pmid: '2' } });
    const merged = mergeEvidence([makeSpecialist([real, poster])]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.title).toBe('Bleeding risk in anticoagulated patients');
  });
});

describe('rankEvidenceByRelevance', () => {
  const q = 'compare acetaminophen and diclofenac on renal effect';
  const titled = (title: string, snippet: string) => makeRecord({ source: 'pubmed', title, snippet });
  const onTopicA = titled('Acetaminophen versus diclofenac and renal injury', 'kidney outcomes');
  const onTopicB = titled('Diclofenac nephrotoxicity', 'acute renal failure with diclofenac');
  const synonym = titled('Acetaminophen and kidney function', 'kidney injury markers');
  const offTopic = titled('Pharmacokinetics of paracetamol in the koala', 'marsupial dosing');

  it('ranks records matching more question terms ahead of weak matches', () => {
    const ranked = rankEvidenceByRelevance(q, [offTopic, onTopicA, onTopicB]);
    expect(ranked[0]?.title).toBe('Acetaminophen versus diclofenac and renal injury');
  });

  it('matches "renal" against records that say "kidney" (synonym aware)', () => {
    // Only 3 records, so the drop guard keeps all — but the synonym record must
    // out-rank the off-topic one.
    const ranked = rankEvidenceByRelevance(q, [offTopic, synonym]);
    expect(ranked[0]?.title).toBe('Acetaminophen and kidney function');
  });

  it('drops clearly off-topic records when enough on-topic evidence remains', () => {
    const onTopic = [onTopicA, onTopicB, synonym]
      .concat([1, 2, 3].map((n) => titled(`Diclofenac renal cohort ${n}`, 'kidney')));
    const ranked = rankEvidenceByRelevance(q, [...onTopic, offTopic]);
    expect(ranked.some((r) => r.title.includes('koala'))).toBe(false);
    expect(ranked.length).toBe(onTopic.length);
  });
});

describe('concept-conjunctive ranking', () => {
  const titled = (title: string, snippet = '') => makeRecord({ source: 'pubmed', title, snippet });
  // The real failing query: NSAIDs + warfarin + digoxin in a young population.
  const q = 'full research paper about NSAIDs use with warfarin and digoxin in young population';

  it('groups a term with its synonyms as a single concept', () => {
    const groups = conceptGroups('warfarin and renal effect');
    const renalGroup = groups.find((g) => g.includes('renal'));
    expect(renalGroup).toContain('kidney'); // synonym folded into the same concept
    // "effect"/"and" are filler and produce no concept.
    expect(groups.some((g) => g.includes('effect'))).toBe(false);
  });

  it('credits a record once per concept, not once per synonym', () => {
    const groups = conceptGroups('renal injury'); // one concept: [renal, kidney]
    // A record naming both synonyms still only covers ONE concept.
    expect(conceptCoverage(titled('renal and kidney damage'), groups)).toBe(1);
  });

  it('ranks a multi-drug record above a warfarin-only record', () => {
    const multi = titled('Warfarin and NSAID bleeding risk', 'meta-analysis of warfarin plus NSAIDs');
    const warfarinOnly = titled('Vortioxetine and warfarin pharmacokinetics', 'no effect on warfarin');
    const ranked = rankEvidenceByRelevance(q, [warfarinOnly, multi]);
    expect(ranked[0]?.title).toBe('Warfarin and NSAID bleeding risk');
  });

  it('drops single-concept noise once enough multi-concept records exist', () => {
    const multi = [1, 2, 3, 4, 5, 6].map((n) =>
      titled(`Warfarin NSAID digoxin study ${n}`, 'warfarin nsaids digoxin young'),
    );
    const noise = titled('Vortioxetine pharmacokinetics', 'unrelated antidepressant warfarin note');
    const ranked = rankEvidenceByRelevance(q, [...multi, noise]);
    // The single-concept antidepressant record is excluded as off-target.
    expect(ranked.some((r) => r.title.includes('Vortioxetine'))).toBe(false);
    expect(ranked.length).toBe(multi.length);
  });

  it('keeps every record when the topic is genuinely sparse', () => {
    const a = titled('Warfarin pharmacology', 'warfarin metabolism');
    const b = titled('Digoxin clearance', 'digoxin renal handling');
    const ranked = rankEvidenceByRelevance(q, [a, b]);
    expect(ranked).toHaveLength(2); // sparse topic is never gutted
  });
});

describe('assessEvidenceSufficiency', () => {
  const titled = (title: string, snippet = '') => makeRecord({ source: 'pubmed', title, snippet });
  const q = 'NSAIDs use with warfarin and digoxin in young population';

  it('names the requested concepts that no record covers', () => {
    // Records cover NSAIDs + warfarin, but never digoxin or the young population.
    const evidence = [
      titled('Warfarin and NSAID bleeding risk', 'warfarin nsaids adults'),
      titled('NSAID gastrointestinal safety', 'nsaids warfarin'),
    ];
    const { uncovered, note } = assessEvidenceSufficiency(q, evidence);
    expect(uncovered).toContain('digoxin');
    expect(uncovered).toContain('young');
    expect(note).toBeTruthy();
    expect(note).toContain('digoxin');
  });

  it('never reports instruction words or typos as uncovered concepts', () => {
    // The raw request including "make a full reaserch paper ... with statistics".
    const rawPrompt = 'make a full reaserch paper about NSAIDs use with warfarin and digoxin in young population with statistics';
    const evidence = [titled('Warfarin and NSAID bleeding', 'warfarin nsaids')];
    const { uncovered } = assessEvidenceSufficiency(rawPrompt, evidence);
    for (const junk of ['make', 'full', 'reaserch', 'research', 'paper', 'statistics']) {
      expect(uncovered).not.toContain(junk);
    }
    // The genuine uncovered medical concepts still surface.
    expect(uncovered).toContain('digoxin');
  });

  it('returns no note when every concept is covered', () => {
    const evidence = [
      titled('NSAIDs, warfarin and digoxin in young patients', 'nsaids warfarin digoxin young population'),
    ];
    expect(assessEvidenceSufficiency(q, evidence).note).toBeNull();
  });

  it('returns no note when the retrieval missed everything (handled by the floor)', () => {
    const evidence = [titled('Unrelated cardiology review', 'beta blockers in heart failure')];
    // Every concept uncovered → total miss, left to the low-evidence floor.
    expect(assessEvidenceSufficiency(q, evidence).note).toBeNull();
  });

  it('treats anticoagulant as a drug class — NOAC/warfarin records cover it (no false gap)', () => {
    // The real-run failure: an "anticoagulant" question reported as an evidence
    // gap even though the corpus was full of warfarin / edoxaban / NOAC studies.
    const aq = 'anticoagulant effect on diabetes in elderly patients';
    const evidence = [
      titled('Edoxaban in elderly atrial fibrillation', 'very low dose edoxaban stroke prevention'),
      titled('Warfarin vs NOAC in diabetic patients', 'rivaroxaban diabetes elderly oral anticoagulation'),
    ];
    const { uncovered, note } = assessEvidenceSufficiency(aq, evidence);
    expect(uncovered).not.toContain('anticoagulant');
    expect(note).toBeNull();
  });
});
