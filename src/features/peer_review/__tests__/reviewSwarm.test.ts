import { describe, expect, it } from 'vitest';
import type { AgentReviewResult } from '@core/store/peerReviewStore';
import { parseSuggestions } from '../reviewSwarm';

const doneAgent = (patch: Partial<AgentReviewResult>): AgentReviewResult => ({
  agentId: 'grammar',
  label: 'Grammar & Language',
  status: 'done',
  text: '',
  items: [],
  ...patch,
});

describe('parseSuggestions', () => {
  it('extracts quoted inline replacements as anchored suggestions', () => {
    const suggestions = parseSuggestions([
      doneAgent({
        text: 'SPELLING ERRORS:\n- "bad formed pdfs" -> "poorly formatted PDFs" — context',
        items: ['"bad formed pdfs" -> "poorly formatted PDFs" — context'],
      }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.originalText).toBe('bad formed pdfs');
    expect(suggestions[0]?.suggestedText).toBe('poorly formatted PDFs');
  });

  it('keeps bullet findings fixable when an agent gives no inline replacement', () => {
    const suggestions = parseSuggestions([
      doneAgent({
        agentId: 'statistics',
        label: 'Statistics & Data',
        text: 'REPORTING COMPLETENESS:\n- Confidence intervals are not reported for the primary estimate.',
        items: ['Confidence intervals are not reported for the primary estimate.'],
      }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.type).toBe('statistics');
    expect(suggestions[0]?.originalText).toBe('');
    expect(suggestions[0]?.suggestedText).toBe('');
    expect(suggestions[0]?.description).toContain('Confidence intervals');
  });
});
