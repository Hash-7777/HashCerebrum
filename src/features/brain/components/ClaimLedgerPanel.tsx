// Human-in-the-loop claim ledger editor. Shown after evidence extraction and
// before manuscript drafting so the researcher can curate, delete, or re-grade
// claims. Every change is reflected in the final manuscript.

import { useState } from 'react';
import type { ClaimLedgerEntry } from '../swarm/publicationTypes';
import { Icon } from '@ui/icons';

const STRENGTHS: ClaimLedgerEntry['evidenceStrength'][] = ['strong', 'moderate', 'weak', 'context'];

function strengthLabel(s: ClaimLedgerEntry['evidenceStrength']): string {
  return { strong: 'Strong', moderate: 'Moderate', weak: 'Weak', context: 'Context' }[s];
}

interface Props {
  ledger: ClaimLedgerEntry[];
  onSubmit: (ledger: ClaimLedgerEntry[]) => void;
  onCancel: () => void;
}

export function ClaimLedgerPanel({ ledger: initial, onSubmit, onCancel }: Props) {
  const [entries, setEntries] = useState<ClaimLedgerEntry[]>(initial);

  const remove = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const setStrength = (id: string, strength: ClaimLedgerEntry['evidenceStrength']) =>
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, evidenceStrength: strength } : e)));

  return (
    <div className="claim-ledger-panel">
      <header className="claim-ledger-header">
        <div className="claim-ledger-heading">
          <h3>Claim ledger</h3>
          <span className="claim-ledger-badge">
            {entries.length} of {initial.length} kept
          </span>
        </div>
        <p className="claim-ledger-sub">
          These are the evidence claims the draft will be built from. Delete anything that looks
          off, and set how strong each one is — your choices shape the manuscript and its citations.
        </p>
      </header>

      <div className="claim-ledger-list">
        {entries.length === 0 ? (
          <div className="claim-ledger-empty">
            <Icon name="alert" size={16} />
            <span>No claims left. Add some back or cancel — the draft would have nothing to cite.</span>
          </div>
        ) : (
          entries.map((entry, index) => (
            <article className="claim-card" key={entry.id}>
              <div className="claim-card-top">
                <span className="claim-card-index">{index + 1}</span>
                <span className="claim-card-section">{entry.sectionTarget}</span>
                <button
                  type="button"
                  className="claim-card-remove"
                  onClick={() => remove(entry.id)}
                  aria-label="Delete claim"
                  title="Delete this claim"
                >
                  <Icon name="close" size={12} />
                </button>
              </div>

              <p className="claim-card-text">{entry.claim}</p>

              {entry.numericSupport.length > 0 && (
                <div className="claim-card-figures" aria-label="Reported estimates">
                  {entry.numericSupport.map((figure, i) => (
                    <span className="claim-figure" key={i}>
                      {figure}
                    </span>
                  ))}
                </div>
              )}

              {entry.contradictionNotes.length > 0 && (
                <div className="claim-card-conflict" role="note">
                  <Icon name="alert" size={12} />
                  <span>{entry.contradictionNotes.join(' · ')}</span>
                </div>
              )}

              <div className="claim-card-footer">
                <div className="claim-strength-group" role="group" aria-label="Evidence strength">
                  {STRENGTHS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={`claim-strength-btn claim-strength-btn--${s} ${
                        entry.evidenceStrength === s ? 'is-active' : ''
                      }`}
                      aria-pressed={entry.evidenceStrength === s}
                      onClick={() => setStrength(entry.id, s)}
                    >
                      {strengthLabel(s)}
                    </button>
                  ))}
                </div>
                <span className="claim-card-sources" title={entry.supportingSources.join(', ')}>
                  <span className="claim-card-sources-label">Sources</span>
                  {entry.supportingSources.length ? entry.supportingSources.join(', ') : '—'}
                </span>
              </div>
            </article>
          ))
        )}
      </div>

      <footer className="claim-ledger-footer">
        <span className="claim-count">
          {entries.length} claim{entries.length === 1 ? '' : 's'} will be drafted
        </span>
        <div className="claim-ledger-actions">
          <button type="button" className="claim-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="claim-approve"
            onClick={() => onSubmit(entries)}
            disabled={entries.length === 0}
          >
            Approve &amp; draft
          </button>
        </div>
      </footer>
    </div>
  );
}
