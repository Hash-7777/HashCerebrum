// Confirm dialog for "Delete all" in Memory mode.
//
// This action is genuinely irreversible: unlike pruneChunks, ragStore.clearProject
// takes no snapshot, so there is nothing for undoLastPrune to restore. The native
// window.confirm it replaces gave an unthemed OS box, an inexact sentence, and a
// default-focused OK — one stray Return key emptied a project's memory.
//
// So the dialog states the exact contents being destroyed, states what is NOT
// touched (the usual fear when a delete is this broad), and requires the project
// name to be typed. Typing is the point: it cannot be satisfied by a reflex.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@ui/icons';
import type { RagChunk } from '@core/rag';

export interface DeletionRow {
  count: number;
  label: string;
  detail: string;
}

export interface DeletionSummary {
  total: number;
  rows: DeletionRow[];
  oldest: string;
  newest: string;
}

/** What "Delete all" will destroy, by kind. Pure so the wording the user is
 *  asked to trust is unit-tested rather than only eyeballed. A kind with no
 *  rows is omitted entirely — never listed as "0". */
export function describeDeletion(chunks: RagChunk[], documentCount: number): DeletionSummary {
  let evidence = 0;
  let answers = 0;
  let passages = 0;
  let oldest = '';
  let newest = '';
  for (const chunk of chunks) {
    if (chunk.kind === 'evidence') evidence += 1;
    else if (chunk.kind === 'answer') answers += 1;
    else passages += 1;
    if (!oldest || chunk.createdAt < oldest) oldest = chunk.createdAt;
    if (!newest || chunk.createdAt > newest) newest = chunk.createdAt;
  }
  const rows: DeletionRow[] = [
    {
      count: evidence,
      label: evidence === 1 ? 'source record' : 'source records',
      detail: 'papers and trials retrieved from the medical databases',
    },
    {
      count: answers,
      label: answers === 1 ? 'saved answer' : 'saved answers',
      detail: 'cited findings written by the Brain',
    },
    {
      count: passages,
      label: passages === 1 ? 'passage' : 'passages',
      detail:
        documentCount > 0
          ? `from ${documentCount} imported ${documentCount === 1 ? 'paper' : 'papers'}`
          : 'from imported papers',
    },
  ].filter((row) => row.count > 0);
  return { total: chunks.length, rows, oldest, newest };
}

export function DeleteAllDialog({
  projectName,
  chunks,
  documentCount,
  onConfirm,
  onClose,
}: {
  projectName: string;
  chunks: RagChunk[];
  documentCount: number;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape always cancels — the safe outcome is the reachable one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [onClose]);

  const summary = useMemo(() => describeDeletion(chunks, documentCount), [chunks, documentCount]);
  const { total, rows } = summary;
  // Case-insensitive and trimmed: deliberate, not a spelling test.
  const confirmed = typed.trim().toLowerCase() === projectName.trim().toLowerCase();

  const dateLabel = (iso: string) => {
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
  };
  const from = summary.oldest ? dateLabel(summary.oldest) : null;
  const to = summary.newest ? dateLabel(summary.newest) : null;

  return createPortal(
    <div
      className="prune-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="prune-modal memory-danger-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="memory-delete-all-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="prune-head">
          <div className="prune-head-lead memory-danger-lead">
            <Icon name="alert" size={14} />
            <strong id="memory-delete-all-title">Delete all memory in “{projectName}”</strong>
          </div>
          <button type="button" className="prune-close" onClick={onClose} aria-label="Cancel">
            <Icon name="close" size={13} />
          </button>
        </header>

        <div className="memory-danger-body">
          <p className="memory-danger-lede">
            This permanently deletes <b>{total}</b> saved {total === 1 ? 'finding' : 'findings'} from
            this project
            {from && to && from !== to ? (
              <>
                , saved between {from} and {to}
              </>
            ) : from ? (
              <>, saved on {from}</>
            ) : null}
            .
          </p>

          <ul className="memory-danger-list">
            {rows.map((row) => (
              <li key={row.label}>
                <b>{row.count}</b> {row.label}
                <span>{row.detail}</span>
              </li>
            ))}
          </ul>

          <p className="memory-danger-warn">
            <Icon name="alert" size={12} /> This cannot be undone. Unlike Prune, deleting everything
            keeps no copy to restore.
          </p>

          <p className="memory-danger-safe">
            <Icon name="check" size={12} /> Not affected: memory in your other projects, your chat
            history, imported papers in other projects, and your settings and API keys.
          </p>

          <label className="memory-danger-confirm">
            <span>
              Type <b>{projectName}</b> to confirm
            </span>
            <input
              ref={inputRef}
              type="text"
              value={typed}
              spellCheck={false}
              autoComplete="off"
              placeholder={projectName}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && confirmed) onConfirm();
              }}
              aria-label={`Type ${projectName} to confirm deletion`}
            />
          </label>
        </div>

        <footer className="prune-foot">
          <span className="prune-count">
            {confirmed ? 'Name matches — deletion is enabled' : 'Deletion stays disabled until the name matches'}
          </span>
          <div className="prune-actions">
            <button type="button" className="prune-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="prune-confirm"
              disabled={!confirmed}
              onClick={onConfirm}
              title={
                confirmed
                  ? `Permanently delete all ${total} findings`
                  : 'Type the project name first'
              }
            >
              Delete {total} {total === 1 ? 'finding' : 'findings'}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    globalThis.document.body,
  );
}
