import { useRef, useState } from 'react';
import { usePeerReviewStore, type ReviewedPaper } from '@core/store/peerReviewStore';
import { runPeerReview } from '../reviewEngine';
import { agentModelFor } from '@core/store/agentModelStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';

function ScoreRing({ score }: { score: number }) {
  const tier = score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low';
  return (
    <div className="review-score-ring" data-tier={tier}>
      <span className="review-score-number">{score}</span>
      <span className="review-score-denom">/10</span>
    </div>
  );
}

function BulletList({ items, label }: { items: string[]; label: string }) {
  if (items.length === 0) return null;
  return (
    <section className="review-section">
      <h4>{label}</h4>
      <ul>
        {items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <li key={i}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function TextSection({ text, label }: { text: string; label: string }) {
  if (!text) return null;
  return (
    <section className="review-section">
      <h4>{label}</h4>
      <p>{text}</p>
    </section>
  );
}

function CritiqueSidebar({
  paper,
  onRunReview,
}: {
  paper: ReviewedPaper;
  onRunReview: () => void;
}) {
  const { review, reviewStreaming, reviewError } = paper;

  return (
    <aside className="review-sidebar">
      <header className="review-sidebar-header">
        <div>
          <p className="eyebrow">
            <Icon name="shield" size={10} /> Peer Review
          </p>
          <h3 className="review-sidebar-title">{paper.title}</h3>
        </div>
        {review && <ScoreRing score={review.score} />}
      </header>

      {!review && !reviewStreaming && (
        <div className="review-sidebar-empty">
          <p>Run the AI peer review to get a scored critique of this paper.</p>
          <button type="button" className="review-run-btn" onClick={onRunReview}>
            <Icon name="shield" size={14} /> Run Peer Review
          </button>
        </div>
      )}

      {reviewStreaming && (
        <div className="review-sidebar-loading">
          <Icon name="spinner" size={18} />
          <span>Reviewing paper…</span>
        </div>
      )}

      {reviewError && (
        <div className="review-sidebar-error">
          <Icon name="alert" size={14} /> {reviewError}
          <button type="button" className="review-run-btn" onClick={onRunReview}>
            Retry
          </button>
        </div>
      )}

      {review && (
        <div className="review-sidebar-content">
          <TextSection text={review.summary} label="Summary" />
          <BulletList items={review.strengths} label="Strengths" />
          <BulletList items={review.weaknesses} label="Weaknesses" />
          <TextSection text={review.methodology} label="Methodology" />
          <TextSection text={review.statistics} label="Statistics" />
          <TextSection text={review.conclusions} label="Conclusions" />
          <TextSection text={review.publishReadiness} label="Publication Readiness" />
          <footer className="review-sidebar-footer">
            Reviewed by {review.modelUsed} · {new Date(review.reviewedAt).toLocaleString()}
          </footer>
          <button type="button" className="review-run-btn review-run-btn--secondary" onClick={onRunReview}>
            <Icon name="refresh" size={12} /> Re-review
          </button>
        </div>
      )}
    </aside>
  );
}

export function ReviewWindow({ paper, onClose }: { paper: ReviewedPaper; onClose: () => void }) {
  const setReview = usePeerReviewStore((s) => s.setReview);
  const setReviewStreaming = usePeerReviewStore((s) => s.setReviewStreaming);
  const setReviewError = usePeerReviewStore((s) => s.setReviewError);
  const abortRef = useRef<AbortController | null>(null);
  const [_streamText, setStreamText] = useState('');

  const runReview = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setReviewStreaming(paper.id, true);
    setStreamText('');

    const model = agentModelFor('boss');
    try {
      const review = await runPeerReview(
        model,
        paper.text,
        (delta) => setStreamText((t) => t + delta),
        controller.signal,
      );
      setReview(paper.id, review);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      const detail = error instanceof Error ? error.message : String(error);
      setReviewError(paper.id, detail);
      useToastStore.getState().show('Peer review failed', 'error');
    }
  };

  return (
    <div className="review-window" role="dialog" aria-label="Peer review" aria-modal="true">
      <button
        type="button"
        className="review-window-close"
        aria-label="Close review"
        onClick={() => {
          abortRef.current?.abort();
          onClose();
        }}
      >
        <Icon name="close" size={16} />
      </button>

      <div className="review-window-body">
        <div className="review-pdf-pane">
          {paper.blobUrl ? (
            <iframe
              src={paper.blobUrl}
              title={paper.title}
              className="review-pdf-frame"
            />
          ) : (
            <div className="review-pdf-text">
              <pre>{paper.text.slice(0, 8000)}</pre>
            </div>
          )}
        </div>
        <CritiqueSidebar paper={paper} onRunReview={() => void runReview()} />
      </div>
    </div>
  );
}
