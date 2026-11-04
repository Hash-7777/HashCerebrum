import { describe, expect, it } from 'vitest';
import { formatEvidenceList, resultExcerpt } from '../evidenceFormat';
import type { EvidenceItem } from '@platform/index';

// An invented abstract in the usual order: background first, results late.
const ABSTRACT = [
  'Heart failure with preserved ejection fraction has few treatments with proven benefit.',
  'We searched three databases for randomised trials of the study drug against placebo.',
  'Trials enrolled adults with an ejection fraction above 40 percent or a recent hospital stay.',
  'Two reviewers extracted data independently and resolved disagreements by discussion.',
  'Risk of bias was assessed with a standard tool and certainty was graded for each outcome.',
  'Results: the study drug reduced the composite of worsening heart failure or cardiovascular death (HR 0.81, 95% CI 0.73-0.90; p<0.001).',
  'All-cause mortality did not differ between groups (HR 0.97, 95% CI 0.88-1.07).',
  'Conclusions: the drug lowers heart failure events in this population.',
].join(' ');

const record = (snippet: string, title = 'A trial'): EvidenceItem =>
  ({ source: 'pubmed', title, authors: [], identifiers: {}, snippet, fetchedAt: '', provenanceHash: '' }) as unknown as EvidenceItem;

describe('resultExcerpt', () => {
  it('returns text that already fits unchanged', () => {
    expect(resultExcerpt('Short abstract. With two sentences.', 500)).toBe('Short abstract. With two sentences.');
  });

  it('keeps the results sentences that a head cut would lose', () => {
    const head = ABSTRACT.slice(0, 400);
    expect(head).not.toContain('HR 0.81');
    const excerpt = resultExcerpt(ABSTRACT, 400);
    expect(excerpt.length).toBeLessThanOrEqual(402);
    expect(excerpt).toContain('HR 0.81, 95% CI 0.73-0.90');
    expect(excerpt.startsWith('Heart failure with preserved ejection fraction')).toBe(true);
  });

  it('marks the gap between sentences that were not next to each other', () => {
    expect(resultExcerpt(ABSTRACT, 400)).toContain(' … ');
  });

  it('does not read the word "or" as an odds ratio', () => {
    // The trials sentence contains "or" but no result; it must not outrank a result.
    const excerpt = resultExcerpt(ABSTRACT, 330);
    expect(excerpt).not.toContain('ejection fraction above 40 percent');
  });
});

describe('formatEvidenceList detail tier', () => {
  it('gives the first records a long excerpt and the rest the short default', () => {
    const block = formatEvidenceList([record(ABSTRACT, 'First'), record(ABSTRACT, 'Second')], {
      markerPrefix: 'S',
      detail: { count: 1, chars: 1100 },
    });
    const [first, second] = block.split('\n');
    expect(first).toContain('HR 0.97');
    expect(second!.length).toBeLessThan(first!.length);
  });

  it('prints the title only when the budget is zero', () => {
    const block = formatEvidenceList([record(ABSTRACT, 'Only the title')], { snippetChars: 0 });
    expect(block).toBe('[1] PUBMED Only the title.');
  });
});
