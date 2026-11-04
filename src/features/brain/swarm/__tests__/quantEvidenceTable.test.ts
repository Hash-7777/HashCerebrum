import { describe, expect, it } from 'vitest';
import {
  withIncompleteDraftBanner,
  INCOMPLETE_DRAFT_BANNER,
} from '../paperPipeline';
import { extractSampleSize } from '../effectExtraction';
import { abstractStatsDigest } from '../evidenceExtraction';
import {
  buildQuantEvidenceTable,
  findUnverifiedStatistics,
  neutralizeUnverifiedStatistics,
} from '../statisticVerification';
import type { EvidenceExtraction } from '../publicationTypes';
import type { Manuscript } from '../manuscript';

function ext(marker: string, partial: Partial<EvidenceExtraction> = {}): EvidenceExtraction {
  return {
    id: `x-${marker}`,
    sourceMarker: marker,
    evidenceIndex: 0,
    source: 'pubmed',
    title: 'A study',
    year: '2024',
    identifiers: {},
    studyDesign: 'RCT',
    population: '',
    exposureOrIntervention: '',
    comparator: '',
    outcomes: [],
    sampleSize: null,
    effectValues: [],
    limitations: [],
    keyFinding: '',
    trusted: true,
    ...partial,
  };
}

describe('buildQuantEvidenceTable', () => {
  it('collects every numeric token a source reports, keyed by its marker', () => {
    const qet = buildQuantEvidenceTable([
      ext('[S12]', {
        boundEffects: [{ measure: 'HR', value: '0.94', ci: '0.90-0.99', pValue: '0.02', direction: 'reduction', sourceText: 'HR 0.94' }],
        effectValues: [{ label: 'hazard ratio', value: '0.86', sourceText: 'HR 0.86' }],
      }),
    ]);
    const s12 = qet.get('[S12]')!;
    expect([...s12].sort()).toEqual(['0.02', '0.86', '0.9', '0.94', '0.99']);
  });
});

describe('findUnverifiedStatistics', () => {
  const qet = new Map<string, Set<string>>([['[S12]', new Set(['0.94', '0.9', '0.99', '0.02'])]]);

  it('flags a statistic attributed to a source that does not report it (D3)', () => {
    // The real bug: [S12] cited with an HR of 1.05 when it only reports 0.94.
    const out = findUnverifiedStatistics(
      'The trial reported a neutral effect (hazard ratio 1.05, 95% CI 1.0-1.1) [S12].',
      qet,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((u) => u.sourceText.includes('1.05'))).toBe(true);
    expect(out[0]!.markers).toEqual(['[S12]']);
  });

  it('passes a statistic the cited source actually reports', () => {
    const out = findUnverifiedStatistics(
      'The trial reported a modest benefit (hazard ratio 0.94, 95% CI 0.90-0.99) [S12].',
      qet,
    );
    expect(out).toEqual([]);
  });

  it('does not check a sentence with no citation', () => {
    expect(findUnverifiedStatistics('Overall the hazard ratio was around 1.05.', qet)).toEqual([]);
  });

  it('flags a context-free garbage number pinned to a source (D4)', () => {
    const out = findUnverifiedStatistics('The analysis yielded an odds ratio of 2.08 [S12].', qet);
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((u) => u.sourceText.includes('2.08'))).toBe(true);
  });
});

describe('neutralizeUnverifiedStatistics', () => {
  const qet = new Map<string, Set<string>>([['[S12]', new Set(['0.94', '0.9', '0.99', '0.02'])]]);

  it('removes a misattributed statistic but keeps the claim and the marker', () => {
    const { text, removed } = neutralizeUnverifiedStatistics(
      'The trial reported a neutral effect (hazard ratio 1.05, 95% CI 1.0-1.1) [S12].',
      qet,
    );
    expect(removed.length).toBeGreaterThan(0);
    expect(text).not.toContain('1.05');
    expect(text).not.toContain('1.0-1.1');
    expect(text).toContain('neutral effect');
    expect(text).toContain('[S12]');
  });

  it('leaves a correctly attributed statistic byte-for-byte unchanged', () => {
    const input = 'The trial reported a modest benefit (hazard ratio 0.94, 95% CI 0.90-0.99) [S12].';
    const { text, removed } = neutralizeUnverifiedStatistics(input, qet);
    expect(removed).toEqual([]);
    expect(text).toBe(input);
  });

  it('does NOT touch a number when the cited source has no extracted stats (extraction gap)', () => {
    const input = 'A cohort reported a hazard ratio of 1.23 [S99].';
    expect(neutralizeUnverifiedStatistics(input, qet).text).toBe(input); // [S99] not in the QET
  });

  it('ignores a sentence with no citation', () => {
    const input = 'Overall the hazard ratio was around 1.05.';
    expect(neutralizeUnverifiedStatistics(input, qet).text).toBe(input);
  });

  it('drops a sentence whose only object was the removed statistic, keeping its neighbours', () => {
    const { text, removed } = neutralizeUnverifiedStatistics(
      'Coupling worsened with exercise [S12]. The relationships were significant at p = 0.03 and p = 0.01 [S12]. Wedge pressure rose [S12].',
      qet,
    );
    expect(removed.length).toBeGreaterThan(0);
    expect(text).toBe('Coupling worsened with exercise [S12]. Wedge pressure rose [S12].');
  });

  it('keeps the sentence when removing the statistic leaves it whole', () => {
    const { text } = neutralizeUnverifiedStatistics(
      'The trial reported a neutral effect (hazard ratio 1.05) [S12].',
      qet,
    );
    expect(text).toBe('The trial reported a neutral effect [S12].');
  });
});

describe('abstractStatsDigest', () => {
  it('lists a source and its effect estimates so the abstract cannot claim it "lacks data"', () => {
    const digest = abstractStatsDigest([
      ext('[S22]', {
        boundEffects: [{ measure: 'HR', value: '0.50', ci: '0.33-0.78', pValue: '0.002', direction: 'reduction', sourceText: 'HR 0.50' }],
      }),
      ext('[S13]', {}), // no effects — omitted
    ]);
    expect(digest).toContain('[S22]');
    expect(digest).toContain('HR 0.50');
    expect(digest).not.toContain('[S13]');
  });

  it('is explicit when nothing quantitative was extracted', () => {
    expect(abstractStatsDigest([ext('[S1]', {})])).toBe('(no effect estimates were extracted)');
  });
});

describe('withIncompleteDraftBanner', () => {
  const base: Manuscript = {
    title: 'A draft',
    abstract: { background: '', objective: '', methods: '', results: '', conclusions: '' },
    keywords: [],
    sections: [{ heading: 'Introduction', body: ['First real paragraph.'] }],
  };

  it('prepends a banner when the draft is not export-ready', () => {
    const notReady: Manuscript = {
      ...base,
      publication: { validation: { exportReady: false } } as unknown as NonNullable<Manuscript['publication']>,
    };
    const out = withIncompleteDraftBanner(notReady);
    expect(out.sections[0]!.body[0]!.startsWith(INCOMPLETE_DRAFT_BANNER)).toBe(true);
    expect(out.sections[0]!.body).toContain('First real paragraph.');
  });

  it('prepends a banner (with a section count) when a section could not be drafted', () => {
    const flagged: Manuscript = {
      ...base,
      sections: [{ heading: 'Introduction', body: ['⚠ SECTION NEEDS REVIEW — could not draft.'] }],
    };
    const out = withIncompleteDraftBanner(flagged);
    expect(out.sections[0]!.body[0]).toContain('1 section could not be fully drafted');
  });

  it('leaves a complete, export-ready manuscript untouched and is idempotent', () => {
    const ready: Manuscript = {
      ...base,
      publication: { validation: { exportReady: true } } as unknown as NonNullable<Manuscript['publication']>,
    };
    expect(withIncompleteDraftBanner(ready)).toEqual(ready);
    const notReady: Manuscript = {
      ...base,
      publication: { validation: { exportReady: false } } as unknown as NonNullable<Manuscript['publication']>,
    };
    const once = withIncompleteDraftBanner(notReady);
    expect(withIncompleteDraftBanner(once)).toEqual(once); // no double banner
  });
});

describe('extractSampleSize', () => {
  it('does not read a trial-version number as a sample size (the "n=4" bug)', () => {
    expect(extractSampleSize('TRAILBLAZER-ALZ 4: a phase 3 trial comparing donanemab with aducanumab.')).toBeNull();
  });

  it('extracts a real study population and skips an early sub-10 misparse', () => {
    expect(extractSampleSize('A phase 2 study that enrolled 856 participants with early AD.')).toBe('n=856');
    expect(extractSampleSize('n = 1,576 participants were pooled across trials.')).toBe('n=1576');
  });
});
