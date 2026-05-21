import type { EvidenceItem } from '@platform/index';
import { Icon } from '@ui/icons';

function sourceCount(items: EvidenceItem[]): number {
  return new Set(items.map((item) => item.source)).size;
}

export function EvidenceList({ items }: { items: EvidenceItem[] }) {
  const sources = sourceCount(items);
  const label = items.length === 1 ? 'record' : 'records';
  const sourceLabel = sources === 1 ? 'source' : 'sources';

  return (
    <section className="evidence-counter-bar" aria-label="Evidence counter">
      <div className="evidence-counter-title">
        <Icon name="document" size={13} />
        <span>Evidence</span>
      </div>
      <div className="evidence-counter-stats">
        <strong>{items.length}</strong>
        <span>{label}</span>
        {sources > 0 && <span>{sources} {sourceLabel}</span>}
      </div>
    </section>
  );
}
