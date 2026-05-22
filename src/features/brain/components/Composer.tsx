import { useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from '@ui/icons';

// The composer no longer carries a model picker — every agent's model is
// resolved per-agent (auto-assigned, overridable in Settings → Agent models).

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
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 42), 164)}px`;
  }, [query]);

  const attachDataset = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onDatasetFile?.(file);
  };

  return (
    <form className="research-composer" onSubmit={onSubmit}>
      {editing && (
        <div className="composer-editing">
          <span>
            <Icon name="edit" size={12} /> Editing earlier prompt
          </span>
          <button type="button" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      )}
      <div className="composer-controls">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.xlsx,.xls,.txt,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="composer-file-input"
          onChange={attachDataset}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="composer-settings"
          aria-label="Attach CSV, TSV, or Excel dataset"
        >
          <Icon name="database" size={13} /> Dataset
        </button>
        <button type="button" onClick={onOpenSettings} className="composer-settings" aria-label="Open settings">
          <Icon name="settings" size={13} /> Settings
        </button>
      </div>
      {datasetLabel && (
        <div className="composer-dataset">
          <span>
            <Icon name="database" size={12} /> {datasetLabel}
          </span>
          {datasetDetail && <small>{datasetDetail}</small>}
          <button type="button" onClick={onClearDataset} aria-label="Remove attached dataset">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}
      <div className="composer-input-row">
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Message HashCerebrum"
          rows={1}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter inserts a newline. isComposing guards
            // IME input (CJK and similar) so a mid-composition Enter does not
            // submit a half-typed message.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (canSubmit && !isRunning) onSubmit(event as unknown as FormEvent);
            }
          }}
        />
        <span className="composer-hint" aria-hidden="true">Enter to send · Shift+Enter for newline</span>
        <button
          type="submit"
          disabled={isRunning || !canSubmit}
          className="composer-send"
          data-running={isRunning ? 'true' : 'false'}
          aria-label={isRunning ? 'Running' : editing ? 'Save edit' : 'Send'}
        >
          <Icon name={isRunning ? 'spinner' : 'send'} size={13} />
          <span>{isRunning ? 'Running' : editing ? 'Save' : 'Send'}</span>
        </button>
      </div>
    </form>
  );
}
