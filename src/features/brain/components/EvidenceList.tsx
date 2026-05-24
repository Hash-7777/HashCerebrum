import { memo } from 'react';
import type { EvidenceItem } from '@platform/index';

const SOURCE_LABELS: Record<string, string> = {
  pubmed: 'PubMed',
  europepmc: 'EuroPMC',
  openalex: 'OpenAlex',
  ctgov: 'ClinicalTrials',
  openfda: 'OpenFDA',
  rxnorm: 'RxNorm',
};

function buildGroups(items: EvidenceItem[]) {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.source, (map.get(item.source) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([source, n]) => ({
    label: SOURCE_LABELS[source] ?? source,
    n,
    pct: Math.round((n / items.length) * 100),
  }));
}

export const EvidenceList = memo(function EvidenceList({ items }: { items: EvidenceItem[] }) {
  const total = items.length;
  const groups = buildGroups(items);
  const sources = new Set(items.map((i) => i.source)).size;

  return (
    <div className="ev" aria-label="Evidence ledger">
      <div className="ev-top">
        <div className="ev-top-left">
          <div className="ev-label">Evidence</div>
          <div className="ev-sub">{total} records · {sources} sources</div>
        </div>
        <div className="ev-total-inline">
          <span className="ev-eq">n=</span>
          <span className="ev-n">{total}</span>
        </div>
      </div>

      {total > 0 && (
        <>
          <div className="ev-stack" title={groups.map((g) => `${g.label}: ${g.n}`).join(' · ')}>
            {groups.map((g, i) => (
              <div
                key={g.label}
                className="ev-seg"
                style={{ flex: g.n, opacity: 1 - i * 0.15 }}
              />
            ))}
          </div>
          <div className="ev-legend">
            {groups.map((g, i) => (
              <span key={g.label} className="ev-leg">
                <span className="ev-leg-mark" style={{ opacity: 1 - i * 0.15 }} />
                {g.label} <b>{g.n}</b>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
});
