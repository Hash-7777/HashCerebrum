import { Icon } from '@ui/icons';
import { PdfGlyph } from '@ui/icons/PdfGlyph';
import type { ReviewedPaper } from '@core/store/peerReviewStore';

function ScoreBadge({ score }: { score: number }) {
  const tier = score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low';
  return (
    <span className="paper-card-score" data-tier={tier}>
      {score}/10
    </span>
  );
}

export function PaperCard({
  paper,
  active,
  onClick,
  onRemove,
}: {
  paper: ReviewedPaper;
  active: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const date = new Date(paper.addedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <article
      className="paper-card"
      data-active={active}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      aria-label={paper.title}
    >
      <div className="paper-card-thumb" aria-hidden="true">
        <PdfGlyph size={30} />
        {paper.reviewStreaming && (
          <span className="paper-card-reviewing">
            <Icon name="spinner" size={14} />
          </span>
        )}
      </div>
      <div className="paper-card-meta">
        <p className="paper-card-title">{paper.title}</p>
        <p className="paper-card-date">{date}</p>
        {paper.review && <ScoreBadge score={paper.review.score} />}
        {paper.reviewError && (
          <span className="paper-card-error">
            <Icon name="alert" size={11} /> Review failed
          </span>
        )}
      </div>
      <button
        type="button"
        className="paper-card-remove"
        aria-label={`Remove ${paper.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Icon name="close" size={11} />
      </button>
    </article>
  );
}
