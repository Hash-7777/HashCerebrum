import { useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from '@ui/icons';
import { useMemorySettingsStore } from '@core/store/memorySettingsStore';
import { useBrainModesStore } from '@core/store/brainModesStore';

export function Composer({
  query,
  setQuery,
  isRunning,
  canSubmit,
  editing = false,
  onCancelEdit,
  onSubmit,
  onStop,
  onOpenSettings,
  datasetLabel,
  datasetDetail,
  onDatasetFile,
  onClearDataset,
  placeholder = 'Ask the Brain. Cite papers, run specialists, draft a literature review…',
}: {
  query: string;
  setQuery: (value: string) => void;
  isRunning: boolean;
  canSubmit: boolean;
  editing?: boolean;
  onCancelEdit?: () => void;
  onSubmit: (event: FormEvent) => void;
  onStop?: () => void;
  onOpenSettings: () => void;
  datasetLabel?: string | null;
  datasetDetail?: string | null;
  onDatasetFile?: (file: File) => void;
  onClearDataset?: () => void;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const memoryEnabled = useMemorySettingsStore((s) => s.enabled);
  const toggleMemory = useMemorySettingsStore((s) => s.toggle);
  const libraryEnabled = useMemorySettingsStore((s) => s.libraryEnabled);
  const toggleLibrary = useMemorySettingsStore((s) => s.toggleLibrary);
  const smartRagEnabled = useMemorySettingsStore((s) => s.smartRagEnabled);
  const toggleSmartRag = useMemorySettingsStore((s) => s.toggleSmartRag);
  const miniEnabled = useBrainModesStore((s) => s.mini);
  const toggleMini = useBrainModesStore((s) => s.toggleMini);
  const outlineFirst = useBrainModesStore((s) => s.outlineFirst);
  const toggleOutlineFirst = useBrainModesStore((s) => s.toggleOutlineFirst);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 180)}px`;
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
      <div className="composer-modes" role="group" aria-label="Research toggles">
        <button
          type="button"
          className="memory-toggle-chip"
          data-on={memoryEnabled}
          onClick={toggleMemory}
          aria-pressed={memoryEnabled}
          title={
            memoryEnabled
              ? 'Memory ON — research may reuse saved findings. Click to research from scratch.'
              : 'Memory OFF — researching from fresh sources only. Click to reuse saved findings.'
          }
        >
          <Icon name="database" size={13} />
          Memory
        </button>
        <button
          type="button"
          className="memory-toggle-chip"
          data-on={libraryEnabled}
          onClick={toggleLibrary}
          aria-pressed={libraryEnabled}
          title={
            libraryEnabled
              ? 'Library ON — the Brain may cite the PDF papers you imported. Click to exclude them.'
              : 'Library OFF — imported papers are not cited. Click to let the Brain cite them.'
          }
        >
          <Icon name="book" size={13} />
          Library
        </button>
        <button
          type="button"
          className="memory-toggle-chip"
          data-on={smartRagEnabled}
          onClick={toggleSmartRag}
          aria-pressed={smartRagEnabled}
          title={
            smartRagEnabled
              ? 'Smart RAG ON — agentic query planning, coverage checks, claim extraction, conflict detection, and citation traversal. Click for classic search.'
              : 'Smart RAG OFF — classic hybrid search only. Click for agentic memory retrieval.'
          }
        >
          <Icon name="agent" size={13} />
          Smart RAG
        </button>
        <button
          type="button"
          className="memory-toggle-chip"
          data-on={miniEnabled}
          onClick={toggleMini}
          aria-pressed={miniEnabled}
          title={
            miniEnabled
              ? 'Brain Mini ON — lighter, faster papers on fewer agents and no rate-limit waiting. Best for free / small Ollama models. Click for the full pipeline.'
              : 'Brain Mini OFF — full-depth pipeline. Click for a lighter, low-quota run.'
          }
        >
          <Icon name="brain" size={13} />
          Mini
        </button>
        <button
          type="button"
          className="memory-toggle-chip"
          data-on={outlineFirst}
          onClick={toggleOutlineFirst}
          aria-pressed={outlineFirst}
          title={
            outlineFirst
              ? 'Outline-first ON — propose the paper structure for you to approve before drafting. Click to draft directly.'
              : 'Outline-first OFF — drafts the full paper immediately. Click to review an outline first.'
          }
        >
          <Icon name="list" size={13} />
          Outline
        </button>
      </div>

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
          placeholder={placeholder}
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
            {isRunning ? (
              <button
                type="button"
                className="send-btn stop-btn"
                onClick={onStop}
                aria-label="Stop"
              >
                Stop
                <Icon name="close" size={14} />
              </button>
            ) : (
              <button
                type="submit"
                className="send-btn"
                disabled={!canSubmit}
                aria-label={editing ? 'Save edit' : 'Send'}
              >
                {editing ? 'Save' : 'Send'}
                <Icon name="send" size={14} />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
