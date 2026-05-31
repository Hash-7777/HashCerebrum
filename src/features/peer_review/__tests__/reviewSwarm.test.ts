import { describe, expect, it } from 'vitest';
import type { AgentReviewResult } from '@core/store/peerReviewStore';
import { chunkDocument, parseSuggestions } from '../reviewSwarm';

describe('chunkDocument', () => {
  it('keeps a short document as a single chunk', () => {
    expect(chunkDocument('short paper', 100)).toEqual(['short paper']);
  });

  it('splits a long document at paragraph boundaries within the budget', () => {
    const para = (n: number) => `${'word '.repeat(18)}p${n}`.trim(); // ~95 chars
    const doc = [para(1), para(2), para(3), para(4)].join('\n\n');
    const chunks = chunkDocument(doc, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    // No content is lost across the split.
    expect(chunks.join(' ')).toContain('p1');
    expect(chunks.join(' ')).toContain('p4');
  });

  it('hard-splits a single paragraph larger than the budget', () => {
    const huge = 'x'.repeat(250);
    const chunks = chunkDocument(huge, 100);
    expect(chunks.length).toBe(3);
    expect(chunks.join('')).toBe(huge);
  });
});

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
