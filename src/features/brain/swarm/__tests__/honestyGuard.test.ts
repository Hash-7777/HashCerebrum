import { describe, expect, it } from 'vitest';
import {
  splitSentences,
  stripFabricatedAppraisal,
  stripCounterfactualDataset,
  stripSearchYieldCounts,
  stripFabricatedAggregates,
  stripNonSourceBrackets,
  softenOverclaims,
  reconcileCrossingCI,
  reconcileDirection,
  reconcileSentenceDirection,
  applyHonestyPass,
  stripPlaceholderBrackets,
} from '../honestyGuard';

describe('stripFabricatedAppraisal', () => {
  it('removes a fabricated GRADE-certainty claim (from the real run)', () => {
    const text =
      'All eight RCTs were rated with low GRADE certainty and flagged for "some concerns" across risk-of-bias domains. The trials enrolled older adults.';
    const out = stripFabricatedAppraisal(text);
    expect(out).not.toMatch(/GRADE/i);
    expect(out).not.toMatch(/some concerns/i);
    expect(out).toContain('The trials enrolled older adults.');
  });

  it('removes ROBINS-I and AMSTAR-2 assertions', () => {
    expect(stripFabricatedAppraisal('The risk-of-bias assessment (ROBINS-I) highlighted high confounding.')).toBe('');
    expect(stripFabricatedAppraisal('The methodological appraisal (AMSTAR-2) identified several concerns.')).toBe('');
  });

  it('KEEPS the honest statement that no appraisal was applied', () => {
    const honest = 'No formal risk-of-bias appraisal (Cochrane RoB, GRADE) was applied in this automated review.';
    expect(stripFabricatedAppraisal(honest)).toBe(honest);
  });

  it('keeps a sentence noting the absence of a GRADE rating', () => {
    const honest = 'The synthesis reports no GRADE certainty rating because no formal appraisal was performed.';
    expect(stripFabricatedAppraisal(honest)).toContain('no GRADE certainty rating');
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'Aspirin reduces ischemic stroke but increases bleeding risk in older adults.';
    expect(stripFabricatedAppraisal(text)).toBe(text);
  });

  it('catches fabricated appraisals written with non-breaking hyphens (U+2011)', () => {
    // The exporter emits "risk‑of‑bias" with U+2011, which ASCII patterns missed.
    const text = 'The reductions held despite the low certainty grading and some concerns about risk‑of‑bias assessment in the trials.';
    expect(stripFabricatedAppraisal(text)).toBe('');
  });

  it('catches "low GRADE ratings" and ROBINS‑I / AMSTAR‑2 forms', () => {
    expect(stripFabricatedAppraisal('These were sources with low GRADE ratings.')).toBe('');
    expect(stripFabricatedAppraisal('The ROBINS‑I and AMSTAR‑2 tools were used.')).toBe('');
  });

  it('still KEEPS the honest "no formal appraisal" sentence with U+2011', () => {
    const honest = 'No formal risk‑of‑bias appraisal (Cochrane RoB, GRADE certainty) was applied in this automated review.';
    expect(stripFabricatedAppraisal(honest)).toBe(honest);
  });

  it('excises a fabricated verdict clause but keeps the honest negation clause (the real compound-sentence run)', () => {
    // The old whole-sentence negation exemption let this through intact: the
    // sentence has an honest negation ("without a formal assessment…") AND a
    // fabricated AMSTAR-2 verdict, so the verdict — a lie — reached the reader.
    const text =
      'The analysis was conducted without a formal assessment of publication bias, leading the authors to rate the overall methodological quality as "some concerns" on the AMSTAR-2 instrument and the certainty of evidence as low.';
    const out = stripFabricatedAppraisal(text);
    expect(out).toContain('without a formal assessment of publication bias');
    expect(out).not.toMatch(/some concerns/i);
    expect(out).not.toMatch(/AMSTAR/i);
  });

  it('drops an internal source id (S1) that rides inside a fabricated verdict clause', () => {
    const text =
      'No formal risk-of-bias assessment or GRADE appraisal was applied to the included records, and the only quality indicator available is the AMSTAR-2 rating of "some concerns" noted for the meta-analysis in S1, which readers must interpret with caution.';
    const out = stripFabricatedAppraisal(text);
    expect(out).toContain('No formal risk-of-bias assessment');
    expect(out).toContain('readers must interpret with caution');
    expect(out).not.toMatch(/some concerns/i);
    expect(out).not.toMatch(/\bin S1\b/);
  });
});

describe('stripCounterfactualDataset', () => {
  it('removes the "had a dataset been provided" padding', () => {
    const text =
      'No external dataset was uploaded for this review. Had a dataset been provided, the pipeline would have recorded the filename, row count, and variable types. The synthesis proceeded as a narrative review.';
    const out = stripCounterfactualDataset(text);
    expect(out).not.toMatch(/had a dataset been provided/i);
    expect(out).toContain('No external dataset was uploaded');
    expect(out).toContain('narrative review');
  });
});

describe('stripSearchYieldCounts', () => {
  it('removes invented/contradictory search-yield record counts', () => {
    expect(stripSearchYieldCounts('The search yielded 320 records for analysis.')).toBe('');
    expect(stripSearchYieldCounts('This produced a total corpus of 159 entries.')).toBe('');
    expect(stripSearchYieldCounts('Records were classified by strength (strong = 76, moderate = 25, weak = 57).')).toBe('');
  });

  it('NEVER removes a real study sample size', () => {
    const real = 'A meta-analysis of 8891 participants reported a benefit.';
    expect(stripSearchYieldCounts(real)).toBe(real);
    const real2 = 'A retrospective cohort of 20000 patients was analysed.';
    expect(stripSearchYieldCounts(real2)).toBe(real2);
  });

  it('removes the contradictory prose totals from the real run (202 / 69)', () => {
    expect(stripSearchYieldCounts('The automated search retrieved 202 unique publications.')).toBe('');
    expect(stripSearchYieldCounts('The analysis relied on the 69 structured evidence items extracted.')).toBe('');
    // A narrated study count is real content and is kept.
    const narrated = 'Three studies reported a consistent cardiovascular benefit.';
    expect(stripSearchYieldCounts(narrated)).toBe(narrated);
  });
});

describe('stripNonSourceBrackets', () => {
  it('removes a leaked placeholder while keeping real [S#] citations', () => {
    expect(
      stripNonSourceBrackets('SGLT2 inhibitors are preferred [guideline context inferred].'),
    ).toBe('SGLT2 inhibitors are preferred.');
    const kept = 'Both classes reduced MACE [S4], with overlap [S2, S7] and a range [S1-S9].';
    expect(stripNonSourceBrackets(kept)).toBe(kept);
  });

  it('leaves single-token bracket notation (e.g. an isotope label) alone', () => {
    const iso = 'Uptake of [18F]FDG was increased.';
    expect(stripNonSourceBrackets(iso)).toBe(iso);
  });

  it('drops a leaked internal claim-ledger id but keeps real [S#] citations', () => {
    // The real run printed "[claim-1]" in the Conclusion — an internal ledger id,
    // never a citation. It has no whitespace, so the single-token rule kept it.
    expect(
      stripNonSourceBrackets('This advance is pivotal [claim-1], as the evidence shows [S3].'),
    ).toBe('This advance is pivotal, as the evidence shows [S3].');
  });
});

describe('stripFabricatedAggregates', () => {
  it('removes a fabricated pooled participant count and invented strength breakdown', () => {
    expect(
      stripFabricatedAggregates(
        'The final evidence set comprised 29 strong, 52 moderate, 17 weak, and 2 contextual sources, representing a pooled sample size of 270 participants.',
      ),
    ).toBe('');
    expect(stripFabricatedAggregates('This yielded a combined sample of 4210 patients.')).toBe('');
    expect(stripFabricatedAggregates('The aggregate enrolment of 1500 subjects was analysed.')).toBe('');
  });

  it('NEVER removes a single real study sample size', () => {
    const real = 'A Medicare cohort study analysed 617,611 patients with atrial fibrillation.';
    expect(stripFabricatedAggregates(real)).toBe(real);
    const real2 = 'The ROCKET AF trial enrolled 6229 elderly patients.';
    expect(stripFabricatedAggregates(real2)).toBe(real2);
  });
});

describe('softenOverclaims', () => {
  it('calibrates over-confident conclusions', () => {
    expect(softenOverclaims('the assembled evidence permits a confident assertion that aspirin causes harm')).toContain(
      'supports a tentative conclusion that',
    );
    expect(softenOverclaims('the trial definitively shows benefit')).toContain('suggests');
  });

  it('leaves calibrated language alone', () => {
    const text = 'the available evidence suggests a modest benefit';
    expect(softenOverclaims(text)).toBe(text);
  });
});

describe('reconcileCrossingCI', () => {
  it('neutralises a significant p-value paired with a CI that crosses 1.0 (the real run)', () => {
    const text = 'aspirin reduced new stroke with a hazard ratio of 0.87 (95 % CI 0.71–1.07) and a p‑value of 0.004.';
    const out = reconcileCrossingCI(text);
    expect(out).not.toMatch(/p[‑\s-]*value of 0\.004/i);
    expect(out).toContain('non-significant result because the 95% CI crosses 1.0');
    expect(out).toContain('hazard ratio of 0.87');
  });

  it('leaves a significant CI (not crossing 1.0) and its p-value alone', () => {
    const text = 'major bleeding rose, hazard ratio 1.94 (95% CI 1.29–2.93), p=0.002.';
    expect(reconcileCrossingCI(text)).toBe(text);
  });

  it('leaves a crossing CI alone when no significance is claimed', () => {
    const text = 'the estimate was HR 0.87 (95% CI 0.71–1.07).';
    expect(reconcileCrossingCI(text)).toBe(text);
  });

  it('leaves a crossing CI with a consistent non-significant p-value', () => {
    const text = 'HR 0.95 (95% CI 0.80–1.12, p=0.42) showed no effect.';
    expect(reconcileCrossingCI(text)).toBe(text);
  });
});

describe('reconcileDirection', () => {
  it('neutralises a benefit verb paired with a ratio > 1', () => {
    const out = reconcileDirection('SGLT2i reduced events with an HR of 1.35.');
    expect(out).toContain('was associated with events with an HR of 1.35');
    expect(out).not.toMatch(/reduced events/i);
  });

  it('neutralises a harm verb paired with a ratio < 1', () => {
    expect(reconcileDirection('the drug increased benefit with RR 0.61')).toContain('was associated with');
  });

  it('leaves a consistent benefit (ratio < 1) untouched', () => {
    const t = 'SGLT2i reduced events with an HR of 0.74.';
    expect(reconcileDirection(t)).toBe(t);
  });

  it('leaves a consistent harm (ratio > 1) untouched', () => {
    const t = 'aspirin increased bleeding (HR 1.94).';
    expect(reconcileDirection(t)).toBe(t);
  });

  it('does not cross a clause boundary to a different ratio', () => {
    // "reduced bleeding" is correct; the HR 1.20 belongs to the mortality clause.
    const t = 'aspirin reduced bleeding, but increased mortality (HR 1.20).';
    expect(reconcileDirection(t)).toBe(t);
  });
});

describe('reconcileSentenceDirection', () => {
  it('neutralises a magnitude claim separated from its ratio by a clause (the real SGLT2 run)', () => {
    const t =
      'Diabetes roughly doubles the risk of atherosclerotic cardiovascular disease, as reflected by a hazard ratio of 0.89 (95% CI 0.84-0.95).';
    const out = reconcileSentenceDirection(t);
    expect(out).not.toMatch(/doubles the risk/i);
    expect(out).toContain('was associated with a hazard ratio of 0.89');
    expect(out).toContain('0.84-0.95'); // the CI is preserved
  });

  it('neutralises a "reduced ... relative risk of 1.4" across a clause', () => {
    const t = 'The therapy reduced cardiovascular mortality substantially, with a relative risk of 1.4.';
    const out = reconcileSentenceDirection(t);
    expect(out).not.toMatch(/reduced cardiovascular mortality/i);
    expect(out).toContain('was associated with a relative risk of 1.4');
  });

  it('leaves a consistent magnitude claim untouched', () => {
    const t = 'Diabetes doubles the risk of ASCVD, with a hazard ratio of 2.10.';
    expect(reconcileSentenceDirection(t)).toBe(t);
  });

  it('does not touch a sentence carrying more than one ratio', () => {
    const t = 'SGLT2i reduced MACE (HR 0.86) but increased genital infection (HR 3.20).';
    expect(reconcileSentenceDirection(t)).toBe(t);
  });

  it('does not touch a sentence with conflicting directional words', () => {
    const t = 'The agent increased benefit and lowered harm, hazard ratio 0.80.';
    expect(reconcileSentenceDirection(t)).toBe(t);
  });

  it('ignores a bare CI with no attached ratio label', () => {
    const t = 'The reduction was clear (95% CI 0.84-0.95) across the cohort.';
    expect(reconcileSentenceDirection(t)).toBe(t);
  });
});

describe('applyHonestyPass', () => {
  it('handles empty input', () => {
    expect(applyHonestyPass('')).toBe('');
  });

  it('composes all three corrections in one pass', () => {
    const text =
      'All eight RCTs were rated with low GRADE certainty. Had a dataset been provided, the pipeline would have computed the row count. The evidence permits a confident assertion that aspirin is harmful.';
    const out = applyHonestyPass(text);
    expect(out).not.toMatch(/GRADE/i);
    expect(out).not.toMatch(/had a dataset been provided/i);
    expect(out).toContain('tentative conclusion');
  });
});

describe('splitSentences', () => {
  it('keeps terminal punctuation and handles a no-punctuation tail', () => {
    expect(splitSentences('One. Two! Three')).toEqual(['One.', ' Two!', 'Three']);
  });

  it('does NOT split on a decimal point (the "0. 86" bug)', () => {
    // "0.86" must stay in one sentence, not become "The HR was 0." + "86 overall."
    expect(splitSentences('The HR was 0.86 overall.')).toEqual(['The HR was 0.86 overall.']);
    expect(splitSentences('CI 0.84-0.95, p=0.0003.')).toEqual(['CI 0.84-0.95, p=0.0003.']);
    // A real sentence boundary after a number still splits.
    expect(splitSentences('It was 0.86. Next point.')).toEqual(['It was 0.86.', ' Next point.']);
  });

  it('does NOT split a domain name (the "ClinicalTrials. gov" bug)', () => {
    // The period inside a domain is intra-token, not a sentence end.
    expect(splitSentences('We searched PubMed and ClinicalTrials.gov for trials.')).toEqual([
      'We searched PubMed and ClinicalTrials.gov for trials.',
    ]);
    // A real boundary after the domain still splits.
    expect(splitSentences('We used ClinicalTrials.gov. Then we screened.')).toEqual([
      'We used ClinicalTrials.gov.',
      ' Then we screened.',
    ]);
  });

  it('protects the intra-word period in an abbreviation like "e.g."', () => {
    // "e.g" is never split into "e" + "g"; the trailing "g." before a space is a
    // soft boundary that rejoins with a single space, so the abbreviation reads
    // back correctly after an honesty round-trip.
    const parts = splitSentences('Newer agents, e.g. empagliflozin, help.');
    expect(parts.join('')).not.toMatch(/e\.\s*$|^\s*g\./); // "e." + "g" never appears
    expect(applyHonestyPass('Newer agents, e.g. empagliflozin, help.')).toBe(
      'Newer agents, e.g. empagliflozin, help.',
    );
  });
});

describe('applyHonestyPass — domain integrity (regression)', () => {
  it('never re-spaces a database domain to "ClinicalTrials. gov"', () => {
    const input =
      'The automated search queried PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, OpenFDA, and RxNorm.';
    const out = applyHonestyPass(input);
    expect(out).toContain('ClinicalTrials.gov');
    expect(out).not.toContain('ClinicalTrials. gov');
  });
});

describe('applyHonestyPass — decimal integrity (regression)', () => {
  it('leaves decimals untouched instead of re-spacing them to "0. 86"', () => {
    const input =
      'Across studies the pooled hazard ratio for MACE was approximately 0.86, 95% CI 0.84-0.95, p=0.0003.';
    const out = applyHonestyPass(input);
    expect(out).toContain('0.86');
    expect(out).toContain('0.84-0.95');
    expect(out).toContain('p=0.0003');
    expect(out).not.toMatch(/\d\.\s\d/); // no "0. 86" anywhere
  });
});

describe('stripPlaceholderBrackets', () => {
  it('drops a placeholder bracket and the dash left dangling after it', () => {
    expect(
      stripPlaceholderBrackets('One analysis examines safety in HFpEF [S25-adjacent record set] —— that is, the record [S3] concerns uric acid.'),
    ).toBe('One analysis examines safety in HFpEF that is, the record [S3] concerns uric acid.');
  });

  it('keeps citation markers, single-token brackets and link text', () => {
    const text = 'Uptake rose [S2][S4]; tracer [18F] was used; see [the trial registry](https://example.org).';
    expect(stripPlaceholderBrackets(text)).toBe(text);
  });

  it('keeps line breaks so headings and lists survive', () => {
    const text = '## Bottom line\n\n- First point [citation needed].\n- Second point [S1].';
    expect(stripPlaceholderBrackets(text)).toBe('## Bottom line\n\n- First point.\n- Second point [S1].');
  });
});
