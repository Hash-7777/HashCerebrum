import type { EvidenceItem } from '@platform/index';
import { Icon } from '@ui/icons';

function evidenceKey(item: EvidenceItem, index: number) {
  return item.provenanceHash || `${item.source}-${item.title}-${index}`;
}

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  return (
    <section className="evidence-list" aria-label="Evidence cards">
      <header>
        <h3>
          <Icon name="document" size={12} /> Evidence
        </h3>
        <span>{items.length}</span>
      </header>
      <div>
        {items.length === 0 && <p className="empty">No records yet. Ask a research question above.</p>}
        {items.slice(0, 12).map((item, index) => (
          <article key={evidenceKey(item, index)} className="evidence-card">
            <header>
              <span className="evidence-tag">
                <Icon name="quote" size={11} /> [S{index + 1}] {item.source}
              </span>
              {item.year && <time>{item.year}</time>}
            </header>
            <h4>{item.title}</h4>
            {item.snippet && <p>{item.snippet}</p>}
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer">
                <Icon name="eye" size={12} /> Open source
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
