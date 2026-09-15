// The Brain chat's header: the title, the turn and evidence counters with the
// live run stage, and — once a conversation has turns — the export and clear
// actions, whose work the workspace passes in.

import { Icon } from '@ui/icons';

export function ChatHeader({
  isRunning,
  turnCount,
  evidenceCount,
  draftProgress,
  onExportMarkdown,
  onExportPdf,
  onClear,
}: {
  isRunning: boolean;
  turnCount: number;
  evidenceCount: number;
  draftProgress: string | null;
  onExportMarkdown: () => void;
  onExportPdf: () => void;
  onClear: () => void;
}) {
  return (
    <header className="chat-header">
      <div className="chat-header-row">
        <div className="chat-head-left">
          <h1 className="brain-title"><em>The</em> Brain</h1>
          <div className={`brain-rule${isRunning ? ' is-running' : ''}`} aria-hidden="true"><span /></div>
          <div className="chat-meta">
            <span className="meta-item"><b>{String(turnCount).padStart(2, '0')}</b> turns</span>
            {evidenceCount > 0 && (
              <>
                <span className="meta-div" aria-hidden="true" />
                <span className="meta-item meta-accent"><b>{String(evidenceCount).padStart(2, '0')}</b> evidence</span>
              </>
            )}
            {(draftProgress || isRunning) && (
              <>
                <span className="meta-div" aria-hidden="true" />
                <span className="meta-run">{draftProgress || 'running'}</span>
              </>
            )}
          </div>
        </div>
        {turnCount > 0 && (
          <div className="chat-export-actions">
            <button
              type="button"
              className="export-btn"
              onClick={onExportMarkdown}
            >
              <Icon name="document" size={13} /> Export MD
            </button>
            <button
              type="button"
              className="export-btn export-primary"
              onClick={onExportPdf}
            >
              <Icon name="filePdf" size={13} /> Export PDF
            </button>
            <button
              type="button"
              className="export-btn export-clear"
              onClick={onClear}
              title="Clear workspace"
            >
              <Icon name="close" size={12} /> Clear
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
