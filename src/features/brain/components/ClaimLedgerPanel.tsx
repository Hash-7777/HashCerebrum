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

function strengthClass(s: ClaimLedgerEntry['evidenceStrength']): string {
  return `claim-strength claim-strength--${s}`;
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
        <h3>Claim Ledger</h3>
        <p className="claim-ledger-sub">
          Review the extracted claims before drafting. Deleted claims are removed from the manuscript.
          Reordering changes citation priority.
        </p>
      </header>

      <div className="claim-ledger-table-wrap">
        <table className="claim-ledger-table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Section</th>
              <th>Strength</th>
              <th>Sources</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="claim-text">{entry.claim}</td>
                <td className="claim-section">{entry.sectionTarget}</td>
                <td>
                  <select
                    className={strengthClass(entry.evidenceStrength)}
                    value={entry.evidenceStrength}
                    onChange={(e) => setStrength(entry.id, e.target.value as ClaimLedgerEntry['evidenceStrength'])}
                  >
                    {STRENGTHS.map((s) => (
                      <option key={s} value={s}>
                        {strengthLabel(s)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="claim-sources">{entry.supportingSources.join(', ')}</td>
                <td className="claim-actions">
                  <button type="button" onClick={() => remove(entry.id)} aria-label="Delete claim">
                    <Icon name="close" size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer className="claim-ledger-footer">
        <span className="claim-count">{entries.length} claim(s)</span>
        <div className="claim-ledger-actions">
          <button type="button" className="claim-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="claim-approve" onClick={() => onSubmit(entries)}>
            Approve & Draft
          </button>
        </div>
      </footer>
    </div>
  );
}
