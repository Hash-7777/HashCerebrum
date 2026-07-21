import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import {
  comparisonArms,
  hasHeadToHeadEvidence,
  neutralizeUnsupportedComparator,
} from '../comparatorGuard';

const rec = (title: string, snippet = ''): EvidenceItem => ({
  title,
  authors: [],
  identifiers: {},
  fetchedAt: '',
  provenanceHash: 'h',
  source: 'pubmed',
  snippet,
});

const QUESTION =
  'Write a systematic review comparing SGLT2 inhibitors with GLP-1 receptor agonists for major adverse cardiovascular events in type 2 diabetes.';

describe('comparisonArms', () => {
  it('extracts the two arms with distinctive signature tokens', () => {
    const arms = comparisonArms(QUESTION);
    expect(arms).not.toBeNull();
    expect(arms!.aSig).toContain('sglt2');
    expect(arms!.bSig).toContain('glp-1');
  });

  it('returns null when the question is not a two-arm comparison', () => {
    expect(comparisonArms('Summarise the cardiovascular benefits of SGLT2 inhibitors.')).toBeNull();
  });
});

describe('hasHeadToHeadEvidence', () => {
  const arms = comparisonArms(QUESTION)!;

  it('is false when sources compare one arm to "other glucose-lowering drugs" only', () => {
    const evidence = [
      rec('Cardiovascular outcomes of SGLT-2 inhibitors versus other glucose-lowering drugs'),
      rec('A 2014 position statement on hyperglycaemia management'),
    ];
    expect(hasHeadToHeadEvidence(evidence, arms)).toBe(false);
  });

  it('is true when a source directly compares the two arms', () => {
    const evidence = [
      rec('SGLT2 inhibitors versus GLP-1 receptor agonists: a comparative effectiveness study of MACE'),
    ];
    expect(hasHeadToHeadEvidence(evidence, arms)).toBe(true);
  });
});

describe('neutralizeUnsupportedComparator', () => {
  const noHeadToHead: EvidenceItem[] = [
    rec('Cardiovascular outcomes of SGLT-2 inhibitors versus other glucose-lowering drugs in T2DM'),
  ];

  it('removes a fabricated "relative to <other arm>" clause on an effect estimate (the real abstract lie)', () => {
    const text =
      'The pooled odds ratio of 0.71 (95% CI 0.67-0.75) indicated a reduction in 3-point MACE for SGLT2 inhibitors relative to GLP-1 receptor agonists.';
    const out = neutralizeUnsupportedComparator(text, QUESTION, noHeadToHead);
    expect(out.text).not.toMatch(/relative to GLP-1/i);
    expect(out.text).toContain('for SGLT2 inhibitors');
    expect(out.text).toContain('odds ratio of 0.71');
    expect(out.removed.length).toBe(1);
  });

  it('removes a "compared with <other arm>" clause too', () => {
    const text =
      'SGLT2 inhibitors reduced major adverse cardiovascular events compared with GLP-1 receptor agonists, as reflected by an odds ratio of 0.71.';
    const out = neutralizeUnsupportedComparator(text, QUESTION, noHeadToHead);
    expect(out.text).not.toMatch(/compared with GLP-1/i);
    expect(out.text).toContain('odds ratio of 0.71');
  });

  it('does NOT touch an honest comparator that is not the other arm', () => {
    const text =
      'The odds ratio of 0.71 was reported for SGLT2 inhibitors versus other glucose-lowering drugs.';
    const out = neutralizeUnsupportedComparator(text, QUESTION, noHeadToHead);
    expect(out.text).toBe(text);
    expect(out.removed).toEqual([]);
  });

  it('does NOT fire when a real head-to-head source exists', () => {
    const headToHead = [
      rec('SGLT2 inhibitors versus GLP-1 receptor agonists for MACE: a comparative effectiveness analysis'),
    ];
    const text =
      'The odds ratio of 0.71 favoured SGLT2 inhibitors relative to GLP-1 receptor agonists.';
    const out = neutralizeUnsupportedComparator(text, QUESTION, headToHead);
    expect(out.text).toBe(text);
  });

  it('does NOT touch a sentence with no effect estimate', () => {
    const text = 'Both SGLT2 inhibitors and GLP-1 receptor agonists are recommended for high-risk patients.';
    const out = neutralizeUnsupportedComparator(text, QUESTION, noHeadToHead);
    expect(out.text).toBe(text);
  });

  it('is inert when the question is not a two-arm comparison', () => {
    const text = 'The odds ratio of 0.71 favoured SGLT2 inhibitors relative to GLP-1 receptor agonists.';
    const out = neutralizeUnsupportedComparator(text, 'Review SGLT2 inhibitors for heart failure.', noHeadToHead);
    expect(out.text).toBe(text);
  });
});
