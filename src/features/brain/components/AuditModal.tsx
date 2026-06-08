// Audit-view modal — replays the hash-chained audit log and surfaces
// any broken link. The Rust side's `audit_log_verify` returns the
// first sequence number whose prev_hash does not match the expected
// previous entry hash; null means the chain is intact end-to-end.
//
// Opening the modal triggers a fresh verify + read. We do not poll;
// the audit log only changes on guarded actions, so a manual refresh
// button covers the rare "view live" case.

import { useEffect, useState } from 'react';
import { platform } from '@platform/index';
import type { AuditEntry } from '@core/bus/events';
import { Icon } from '@ui/icons';

type LoadState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; entries: AuditEntry[]; brokenSeq: number | null; total: number }
  | { state: 'error'; message: string };

const PAGE_SIZE = 100;

export function AuditModal({ onClose }: { onClose: () => void }) {
  const [load, setLoad] = useState<LoadState>({ state: 'idle' });
  const [page, setPage] = useState(0);

  const refresh = async (p = page) => {
    setLoad({ state: 'loading' });
    try {
      const offset = p * PAGE_SIZE;
      const [entries, total, brokenSeq] = await Promise.all([
        platform().audit.read({ offset, limit: PAGE_SIZE }),
        platform().audit.count(),
        platform().audit.verify(),
      ]);
      setLoad({ state: 'ready', entries, total, brokenSeq });
    } catch (error) {
      setLoad({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const resetLog = async () => {
    const ok = window.confirm(
      'Reset the audit log?\n\nThis clears every recorded entry and starts a fresh hash chain. ' +
        'Past activity history is removed permanently; actions are logged again from now on. ' +
        'Use this to retire a legacy chain so verification reads intact.',
    );
    if (!ok) return;
    setLoad({ state: 'loading' });
    try {
      await platform().audit.reset();
      setPage(0);
      await refresh(0);
    } catch (error) {
      setLoad({ state: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  useEffect(() => {
    void refresh(page);
  }, [page]);

  return (
    <div className="audit-modal-backdrop" role="dialog" aria-modal="true" aria-label="Audit log">
      <aside className="audit-modal">
        <header>
          <div>
            <p className="eyebrow">
              <Icon name="shield" size={10} /> Audit
            </p>
            <h3>Hash-chained log</h3>
          </div>
          <div className="audit-actions">
            <button type="button" onClick={() => void refresh()} aria-label="Refresh audit log">
              <Icon name="pulse" size={13} /> Refresh
            </button>
            <button
              type="button"
              className="audit-reset"
              onClick={() => void resetLog()}
              aria-label="Reset audit log"
            >
              <Icon name="refresh" size={13} /> Reset log
            </button>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close audit log">
              <Icon name="close" size={14} />
            </button>
          </div>
        </header>

        {load.state === 'loading' && (
          <p className="audit-status">
            <Icon name="spinner" size={13} /> Replaying chain…
          </p>
        )}

        {load.state === 'error' && (
          <p className="audit-status audit-status-error">
            <Icon name="alert" size={13} /> {load.message}
          </p>
        )}

        {load.state === 'ready' && (
          <>
            <div className="audit-summary" data-broken={load.brokenSeq !== null}>
              {load.brokenSeq === null ? (
                <>
                  <Icon name="check" size={14} /> Chain intact · {load.total} entries
                </>
              ) : (
                <>
                  <Icon name="alert" size={14} /> Chain broken at seq {load.brokenSeq}
                </>
              )}
            </div>

            {load.entries.length === 0 ? (
              <p className="audit-status">No guarded actions yet.</p>
            ) : (
              <>
                <div className="audit-pager">
                  <span>
                    {page * PAGE_SIZE + 1}-{page * PAGE_SIZE + load.entries.length} of {load.total}
                  </span>
                  <div>
                    <button type="button" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={(page + 1) * PAGE_SIZE >= load.total}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
                <ol className="audit-list">
                  {load.entries.map((entry) => (
                    <li
                      key={`${entry.seq}-${entry.entry_hash}`}
                      data-broken={load.brokenSeq !== null && entry.seq >= load.brokenSeq}
                    >
                      <header>
                        <span className="audit-seq">#{entry.seq}</span>
                        <time>{new Date(entry.ts).toLocaleString()}</time>
                      </header>
                      <div className="audit-action">
                        <strong>{entry.category}</strong>
                        <span>{entry.subject}</span>
                        <span className="audit-verb">{entry.action}</span>
                      </div>
                      <div className="audit-hashes">
                        <code title="entry_hash">{entry.entry_hash.slice(0, 16)}...</code>
                        <span className="audit-arrow">&lt;-</span>
                        <code title="prev_hash">{entry.prev_hash.slice(0, 16)}...</code>
                      </div>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
