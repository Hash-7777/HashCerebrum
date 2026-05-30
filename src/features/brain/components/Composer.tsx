import { useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from '@ui/icons';

export function Composer({
  query,
  setQuery,
  isRunning,
  canSubmit,
  editing = false,
  onCancelEdit,
  onSubmit,
  onOpenSettings,
  datasetLabel,
  datasetDetail,
  onDatasetFile,
  onClearDataset,
}: {
  query: string;
  setQuery: (value: string) => void;
  isRunning: boolean;
  canSubmit: boolean;
  editing?: boolean;
  onCancelEdit?: () => void;
  onSubmit: (event: FormEvent) => void;
  onOpenSettings: () => void;
  datasetLabel?: string | null;
  datasetDetail?: string | null;
  onDatasetFile?: (file: File) => void;
  onClearDataset?: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 48), 180)}px`;
    // When the box is filled programmatically (a ready-prompt chip or an
    // edit-message action) rather than by typing, focus it and drop the
    // cursor at the end so the user can refine the text before sending.
    if (query && document.activeElement !== textarea) {
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    }
  }, [query]);

  const attachDataset = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onDatasetFile?.(file);
  };

  return (
    <div className="composer-wrap">
      <form className="composer" onSubmit={onSubmit}>
        {editing && (
          <div className="composer-editing">
            <span><Icon name="edit" size={12} /> Editing earlier prompt</span>
            <button type="button" onClick={onCancelEdit}>Cancel</button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.txt,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="composer-file-input"
          onChange={attachDataset}
        />

        {datasetLabel && (
          <div className="composer-dataset">
            <span><Icon name="database" size={12} /> {datasetLabel}</span>
            {datasetDetail && <small>{datasetDetail}</small>}
            <button type="button" onClick={onClearDataset} aria-label="Remove dataset">
              <Icon name="close" size={12} />
            </button>
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="composer-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Ask the Brain. Cite papers, run specialists, draft a literature review…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (canSubmit && !isRunning) onSubmit(e as unknown as FormEvent);
            }
          }}
        />

        <div className="composer-toolbar">
          <div className="tools-left">
            <button
              type="button"
              className="dataset-chip"
              onClick={() => fileRef.current?.click()}
              title="Attach dataset"
            >
              <Icon name="database" size={13} />
              Dataset
              <Icon name="chevDown" size={12} />
            </button>
            <button type="button" className="icon-btn" title="Search">
              <Icon name="search" size={15} />
            </button>
          </div>
          <div className="tools-right">
            <button type="button" className="btn ghost sm" onClick={onOpenSettings}>
              <Icon name="settings" size={13} /> Settings
            </button>
            <button
              type="submit"
              className="send-btn"
              disabled={isRunning || !canSubmit}
              data-running={isRunning ? 'true' : 'false'}
              aria-label={isRunning ? 'Running' : editing ? 'Save edit' : 'Send'}
            >
              {isRunning ? 'Running' : editing ? 'Save' : 'Send'}
              <Icon name={isRunning ? 'spinner' : 'send'} size={14} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
