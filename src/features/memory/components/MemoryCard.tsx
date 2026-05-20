// One saved RAG chunk — a retrieved record or a synthesized answer from an
// earlier research run in the active project.

import type { RagChunk } from '@core/store/ragStore';
import { Icon } from '@ui/icons';

const EXCERPT_CHARS = 360;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString();
}

export function MemoryCard({
  chunk,
  onRemove,
}: {
  chunk: RagChunk;
  onRemove: (id: string) => void;
}) {
  const excerpt = chunk.text.replace(/\s+/g, ' ').trim();
  const shown = excerpt.length > EXCERPT_CHARS ? `${excerpt.slice(0, EXCERPT_CHARS)}…` : excerpt;
  const kindLabel = chunk.kind === 'answer' ? 'Answer' : 'Evidence';
  const date = formatDate(chunk.createdAt);

  return (
    <article className="memory-card" data-kind={chunk.kind}>
      <header>
        <div>
          <span className="memory-kind">{kindLabel}</span>
          <span className="memory-source">{chunk.source}</span>
        </div>
        <button
          type="button"
          className="memory-remove"
          onClick={() => onRemove(chunk.id)}
          aria-label={`Delete saved ${kindLabel.toLowerCase()}: ${chunk.title}`}
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      <h4>{chunk.title}</h4>
      <p className="memory-excerpt">{shown}</p>
      <footer>
        {chunk.url ? (
          <a
            className="memory-link"
            href={chunk.url}
            target="_blank"
            rel="noreferrer noopener"
          >
            <Icon name="document" size={11} /> Source
          </a>
        ) : (
          <span />
        )}
        {date ? <time className="memory-date">{date}</time> : null}
      </footer>
    </article>
  );
}
