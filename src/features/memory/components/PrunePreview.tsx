// Preview-and-confirm dialog for the one-click Prune. Shows exactly what would
// be removed and WHY (off-topic, duplicate, meta/app, low-value), lets the user
// deselect anything to keep, and offers an aggressive tier — so a destructive
// cleanup becomes transparent and deliberate. Portaled to <body> with a high
// z-index so it floats above all app chrome (same pattern as the doc preview).

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@ui/icons';
import type { PruneReason, PrunePlan } from '../pruneMemory';

const REASON_ORDER: PruneReason[] = ['off-topic', 'duplicate', 'low-value', 'meta'];
const REASON_LABEL: Record<PruneReason, string> = {
  'off-topic': 'Off-topic',
  duplicate: 'Duplicate',
  'low-value': 'Low-value',
  meta: 'Meta / app',
};

export function PrunePreview({
  plan,
  aggressive,
  busy,
  onAggressiveChange,
  onConfirm,
  onClose,
}: {
  plan: PrunePlan;
  aggressive: boolean;
  busy: boolean;
  onAggressiveChange: (value: boolean) => void;
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
}) {
  // Ids the user has un-checked — flagged for removal but kept on confirm.
  const [kept, setKept] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setKept((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeList = plan.remove.filter((decision) => !kept.has(decision.chunk.id));
  const ordered = [...plan.remove].sort(
    (a, b) => REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason),
  );

  return createPortal(
    <div
      className="prune-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="prune-modal" onPointerDown={(event) => event.stopPropagation()} aria-label="Prune memory">
        <header className="prune-head">
          <div className="prune-head-lead">
            <Icon name="refresh" size={14} />
            <strong>Prune memory</strong>
          </div>
          <button type="button" className="prune-close" onClick={onClose} aria-label="Close">
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="prune-summary">
          {REASON_ORDER.filter((reason) => plan.counts[reason] > 0).map((reason) => (
            <span key={reason} className={`prune-chip prune-chip--${reason}`}>
              {REASON_LABEL[reason]} {plan.counts[reason]}
            </span>
          ))}
          {plan.remove.length === 0 && <span className="prune-chip prune-chip--clean">Already clean</span>}
        </div>

        <label className="prune-aggressive">
          <input
            type="checkbox"
            checked={aggressive}
            disabled={busy}
            onChange={(event) => onAggressiveChange(event.target.checked)}
          />
          <span>Also drop weak, unsourced evidence (context-only or no PMID/DOI)</span>
        </label>

        {plan.remove.length === 0 ? (
          <div className="prune-empty">
            <Icon name="check" size={18} />
            <p>Nothing to prune — every finding is on-topic, unique, and source-backed.</p>
          </div>
        ) : (
          <ul className="prune-list">
            {ordered.map((decision) => {
              const keep = kept.has(decision.chunk.id);
              return (
                <li key={decision.chunk.id} className="prune-item" data-keep={keep}>
                  <input
                    type="checkbox"
                    checked={!keep}
                    disabled={busy}
                    onChange={() => toggle(decision.chunk.id)}
                    aria-label={keep ? 'Keep this finding' : 'Remove this finding'}
                  />
                  <span className={`prune-reason prune-reason--${decision.reason}`}>
                    {REASON_LABEL[decision.reason]}
                  </span>
                  <span className="prune-item-text">
                    <strong>{decision.chunk.title || '(untitled finding)'}</strong>
                    {decision.detail && <span>{decision.detail}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="prune-foot">
          <span className="prune-count">
            Keep {plan.keptCount + kept.size} · Remove {removeList.length}
          </span>
          <div className="prune-actions">
            <button type="button" className="prune-cancel" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="prune-confirm"
              disabled={busy || removeList.length === 0}
              onClick={() => onConfirm(removeList.map((decision) => decision.chunk.id))}
            >
              {busy ? 'Pruning…' : `Prune ${removeList.length}`}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    globalThis.document.body,
  );
}
