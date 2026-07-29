import { describe, expect, it } from 'vitest';
import type { AgentReviewResult } from '@core/store/peerReviewStore';
import {
  buildPaperReview,
  chunkDocument,
  parseSuggestions,
  reviewParts,
} from '../reviewSwarm';
import { isContextTooLarge, isRateLimited } from '@core/llm/errorKind';

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

describe('reviewParts', () => {
  it('returns a short manuscript whole', () => {
    expect(reviewParts('one\n\ntwo')).toEqual(['one\n\ntwo']);
  });

  it('caps a long manuscript to at most MAX_REVIEW_PARTS chunks', () => {
    // 12 sizeable sections → would be ~many chunks; reviewParts condenses them.
    const sections = Array.from({ length: 12 }, (_, i) => `Section ${i + 1}\n${'word '.repeat(2000)}`);
    const doc = sections.join('\n\n');
    const parts = reviewParts(doc);
    expect(parts.length).toBeLessThanOrEqual(3);
    // Every section is still represented (headings survive the condensation).
    const joined = parts.join('\n');
    expect(joined).toContain('Section 1');
    expect(joined).toContain('Section 12');
    // It used an ellipsis marker to show trimming, not silent loss.
    expect(joined).toContain('[…]');
  });
});

describe('error classification', () => {
  it('treats a tokens-per-minute / 429 message as a rate limit, NOT a size error', () => {
    const tpm = new Error('groq HTTP 429: Rate limit reached ... tokens per minute');
    expect(isRateLimited(tpm)).toBe(true);
    expect(isContextTooLarge(tpm)).toBe(false); // the bug that caused the shrink loop

    expect(isRateLimited(new Error('Requests per minute limit exceeded'))).toBe(true);
    expect(isRateLimited(new Error('provider cooling down from a recent rate limit'))).toBe(true);
    expect(isRateLimited(new Error('You exceeded your current quota'))).toBe(true);
  });

  it('treats a 413 / context-length message as a size error, NOT a rate limit', () => {
    const big = new Error('HTTP 413: request too large; reduce your message size');
    expect(isContextTooLarge(big)).toBe(true);
    expect(isRateLimited(big)).toBe(false);
    expect(isContextTooLarge(new Error('maximum context length is 8192 tokens'))).toBe(true);
  });
});

describe('buildPaperReview', () => {
  const run = (agentId: string, patch: Partial<{ text: string; error: string }> = {}) => ({
    agentId,
    text: patch.text ?? '',
    modelUsed: 'test-model',
    error: patch.error,
  });

  it('builds the scored review from the orchestrator when it completed', () => {
    const review = buildPaperReview(
      [
        run('orchestrator', { text: 'SCORE: 7\n\nSUMMARY:\nSolid.\n\nSTRENGTHS:\n- clear\n\nWEAKNESSES:\n- thin stats' }),
        run('statistics', { text: '- CIs missing' }),
      ],
      'test-model',
    );
    expect(review.score).toBe(7);
    expect(review.summary).toContain('Solid');
    expect(review.agentResults).toHaveLength(2);
  });

  it('degrades to a labelled partial review when the orchestrator failed', () => {
    const review = buildPaperReview(
      [
        run('orchestrator', { error: 'HTTP 429: rate limit' }),
        run('statistics', { text: '- Confidence intervals are not reported.' }),
        run('grammar', { text: '- Several comma splices.' }),
      ],
      'test-model',
    );
    expect(review.score).toBe(0);
    expect(review.summary).toContain('Partial review');
    expect(review.publishReadiness).toContain('Incomplete');
    // The specialists' findings are preserved as weaknesses.
    expect(review.weaknesses.join(' ')).toContain('Confidence intervals');
    expect(review.statistics).toContain('Confidence intervals');
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
