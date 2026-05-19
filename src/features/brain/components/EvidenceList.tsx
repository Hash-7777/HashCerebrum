import type { EvidenceItem } from '@platform/index';
import { Icon } from '@ui/icons';
import { useResourcesStore } from '@core/store/resourcesStore';

function evidenceKey(item: EvidenceItem, index: number) {
  return item.provenanceHash || `${item.source}-${item.title}-${index}`;
}

function dedupeKey(item: EvidenceItem) {
  return (
    item.url ||
    item.identifiers?.pmid ||
    item.identifiers?.doi ||
    item.provenanceHash ||
    `${item.source}-${item.title}`
  );
}

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  const savedKeys = useResourcesStore((s) =>
    new Set(s.resources.map((r) => dedupeKey(r.evidence))),
  );
  const add = useResourcesStore((s) => s.add);

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
        {items.slice(0, 12).map((item, index) => {
          const saved = savedKeys.has(dedupeKey(item));
          return (
            <article key={evidenceKey(item, index)} className="evidence-card">
              <header>
                <span className="evidence-tag">
                  <Icon name="quote" size={11} /> [S{index + 1}] {item.source}
                </span>
                <div className="evidence-card-actions">
                  {item.year && <time>{item.year}</time>}
                  <button
                    type="button"
                    className="evidence-save"
                    data-saved={saved ? 'true' : 'false'}
                    onClick={() => {
                      if (!saved) add(item);
                    }}
                    title={saved ? 'Saved in Resources' : 'Save to Resources'}
                    aria-label={saved ? 'Saved' : 'Save to Resources'}
                  >
                    <Icon name={saved ? 'check' : 'book'} size={12} />
                  </button>
                </div>
              </header>
              <h4>{item.title}</h4>
              {item.snippet && <p>{item.snippet}</p>}
              {item.url && (
                <a href={item.url} target="_blank" rel="noreferrer">
                  <Icon name="eye" size={12} /> Open source
                </a>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
