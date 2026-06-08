import { describe, it, expect } from 'vitest';
import { buildReviewReportMarkdown } from '../reviewReportMarkdown';
import type { ReviewedPaper } from '@core/store/peerReviewStore';

function makePaper(overrides: Partial<ReviewedPaper> = {}): ReviewedPaper {
  return {
    id: 'p1',
    title: 'A Study of Widget Efficacy',
    filename: 'study.pdf',
    addedAt: '2026-06-08T10:00:00.000Z',
    source: 'manuscript',
    text: 'full text',
    review: {
      score: 7,
      summary: 'A solid manuscript with minor gaps.',
      strengths: ['Clear methodology', 'Adequate sample size'],
      weaknesses: ['Limited discussion of confounders'],
      methodology: 'Randomised controlled trial.',
      statistics: 'Appropriate use of regression.',
      conclusions: 'Conclusions follow from the data.',
      publishReadiness: 'Minor revisions recommended.',
      reviewedAt: '2026-06-08T11:00:00.000Z',
      modelUsed: 'test-model',
      agentResults: [
        { agentId: 'grammar', label: 'Grammar & Language', status: 'done', text: 'Reads well.', items: ['Fix one typo'] },
        { agentId: 'statistics', label: 'Statistics & Data', status: 'done', text: 'Stats are sound and the analysis is appropriate.', items: [] },
        { agentId: 'originality', label: 'Originality Check', status: 'error', text: '', items: [] },
      ],
    },
    ...overrides,
  };
}

describe('buildReviewReportMarkdown', () => {
  it('renders title, score, strengths, weaknesses, and standard sections', () => {
    const md = buildReviewReportMarkdown(makePaper());
    expect(md).toContain('# Peer Review Report');
    expect(md).toContain('## A Study of Widget Efficacy');
    expect(md).toContain('**Score:** 7/10');
    expect(md).toContain('### Strengths');
    expect(md).toContain('- Clear methodology');
    expect(md).toContain('### Weaknesses');
    expect(md).toContain('- Limited discussion of confounders');
    expect(md).toContain('## Methodology');
    expect(md).toContain('## Publication Readiness');
  });

  it('includes finished swarm agents (with items or prose) and skips errored/empty ones', () => {
    const md = buildReviewReportMarkdown(makePaper());
    expect(md).toContain('## Swarm Agent Analysis');
    expect(md).toContain('### Grammar & Language');
    expect(md).toContain('- Fix one typo');
    expect(md).toContain('### Statistics & Data');
    expect(md).toContain('Stats are sound');
    // Errored agent is omitted.
    expect(md).not.toContain('Originality Check');
  });

  it('omits empty standard sections', () => {
    const md = buildReviewReportMarkdown(
      makePaper({
        review: {
          ...makePaper().review!,
          statistics: '',
          conclusions: '   ',
        },
      }),
    );
    // Line-specific so it does not match the '### Statistics & Data' agent heading.
    expect(md).not.toContain('## Statistics\n');
    expect(md).not.toContain('## Conclusions\n');
  });

  it('throws when there is no review', () => {
    const paper = makePaper();
    delete paper.review;
    expect(() => buildReviewReportMarkdown(paper)).toThrow();
  });
});
