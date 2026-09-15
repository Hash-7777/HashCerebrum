// The ask-this-paper panel shown beside a review.

import { useState } from 'react';
import { agentModelFor } from '@core/store/agentModelStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';
import { askPaper, citedPassageNumbers, type PaperPassage } from '../askPaper';

interface AskEntry {
  question: string;
  answer: string;
  passages: PaperPassage[];
}

/**
 * Ask-this-paper panel. Questions are answered strictly from passages of the
 * document, cited with [P#] markers; each cited passage is revealed on click so
 * the answer is verifiable against the exact text it came from.
 */
export function AskPaperPanel({ documentText }: { documentText: string }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<AskEntry[]>([]);

  const submit = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const { answer, passages } = await askPaper(agentModelFor('boss'), q, documentText);
      setEntries((prev) => [{ question: q, answer, passages }, ...prev]);
      setQuestion('');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Ask failed: ${detail}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-ask-block">
      <p className="review-bullets-label review-ask-label">Ask this paper</p>
      <div className="review-ask-input">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Ask a question answered only from this document…"
          rows={2}
          aria-label="Ask this paper a question"
        />
        <button
          type="button"
          className="review-ask-send"
          onClick={() => void submit()}
          disabled={busy || question.trim().length === 0}
          data-busy={busy || undefined}
          aria-label="Ask"
        >
          {busy ? <Icon name="spinner" size={13} /> : <Icon name="send" size={13} />}
        </button>
      </div>
      {entries.map((entry, i) => {
        const cited = citedPassageNumbers(entry.answer)
          .map((n) => entry.passages.find((p) => p.index === n))
          .filter((p): p is PaperPassage => !!p);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only Q&A log
          <div className="review-ask-entry" key={i}>
            <p className="review-ask-q">{entry.question}</p>
            <p className="review-ask-a">{entry.answer}</p>
            {cited.length > 0 && (
              <details className="review-faith-sources">
                <summary>Verify passage{cited.length > 1 ? 's' : ''}</summary>
                {cited.map((p) => (
                  <div className="review-faith-source" key={p.index}>
                    <p className="review-faith-source-title">
                      <span className="review-faith-source-marker">[P{p.index}]</span>
                    </p>
                    <p className="review-faith-source-snippet">{p.text}</p>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}
