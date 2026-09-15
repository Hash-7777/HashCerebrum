/** @vitest-environment jsdom */
// The review window is composed from panels in separate modules — the document
// pane, the result cards, the suggestion card, the ask panel and the editor's
// HTML helpers. Type-checking proves the imports resolve; this proves the
// window still renders from them. No model is called: a review only starts
// from a button, and a text-only paper needs no PDF.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReviewedPaper } from '@core/store/peerReviewStore';
import type { Suggestion } from '../../reviewSwarm';
import { ReviewWindow } from '../ReviewWindow';
import { SuggestionCard } from '../SuggestionCard';
import { buildHighlightedHtml, isSafeUrl } from '../editorHtml';

let container: HTMLDivElement;
let root: Root;

function mount(ui: React.ReactElement) {
  act(() => {
    root.render(ui);
  });
}

// Render, then let pending promises settle — the document pane first looks for
// a stored PDF and only then falls back to the paper's text.
async function mountAndSettle(ui: React.ReactElement) {
  await act(async () => {
    root.render(ui);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const reviewedPaper: ReviewedPaper = {
  id: 'paper-synthetic-1',
  title: 'Synthetic review target',
  filename: 'synthetic.txt',
  addedAt: '2026-01-01T00:00:00.000Z',
  source: 'upload',
  text: 'First paragraph of a synthetic manuscript.\n\nSecond paragraph with a finding.',
  review: {
    score: 7,
    summary: 'A synthetic overall summary.',
    strengths: ['Clear objective'],
    weaknesses: ['Small sample'],
    methodology: 'Synthetic methodology note.',
    statistics: 'Synthetic statistics note.',
    conclusions: 'Synthetic conclusions note.',
    publishReadiness: 'Needs revision.',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    modelUsed: 'test-model',
    agentResults: [
      {
        agentId: 'grammar',
        label: 'Grammar & Language',
        status: 'done',
        text: 'Minor language issues.',
        items: ['Tighten the second paragraph.'],
      },
    ],
  },
};

function suggestion(status: Suggestion['status']): Suggestion {
  return {
    id: `s-${status}`,
    agentId: 'grammar',
    type: 'grammar',
    description: 'Grammar & Language',
    originalText: 'teh finding',
    suggestedText: 'the finding',
    status,
  };
}

describe('ReviewWindow', () => {
  it('renders a reviewed paper: its text, score, summary, agent swarm and faithfulness card', async () => {
    await mountAndSettle(<ReviewWindow paper={reviewedPaper} onClose={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toContain('First paragraph of a synthetic manuscript.');
    expect(text).toContain('7/10');
    expect(text).toContain('A synthetic overall summary.');
    expect(text).toContain('Analysis Swarm');
    expect(text).toContain('Citation Faithfulness');
  });
});

describe('SuggestionCard', () => {
  it('shows the proposed change while pending and collapses once accepted', () => {
    const noop = () => {};
    mount(
      <SuggestionCard suggestion={suggestion('pending')} active={false} onHover={noop} onAccept={noop} onSkip={noop} onFix={noop} />,
    );
    expect(container.textContent).toContain('the finding');

    mount(
      <SuggestionCard suggestion={suggestion('accepted')} active={false} onHover={noop} onAccept={noop} onSkip={noop} onFix={noop} />,
    );
    expect(container.textContent).toContain('Applied');
    expect(container.textContent).not.toContain('teh finding');
  });
});

describe('editor HTML helpers', () => {
  it('escapes document text and marks a pending suggestion in place', () => {
    const html = buildHighlightedHtml('<script>x</script> teh finding', [suggestion('pending')]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<mark class="doc-mark doc-mark--grammar" data-sid="s-pending">teh finding</mark>');
  });

  it('treats only http and https links as safe', () => {
    expect(isSafeUrl('https://pubmed.ncbi.nlm.nih.gov/1/')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,x')).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
  });
});
