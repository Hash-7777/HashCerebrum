import { describe, expect, it } from 'vitest';
import {
  splitSentences,
  stripFabricatedAppraisal,
  stripCounterfactualDataset,
  softenOverclaims,
  reconcileCrossingCI,
  applyHonestyPass,
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
});
