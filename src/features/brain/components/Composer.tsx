import { useEffect, useRef, type FormEvent } from 'react';
import { Icon } from '@ui/icons';
import { useModelCatalogStore } from '@core/store/modelCatalogStore';

export function Composer({
  query,
  setQuery,
  selectedModel,
  setSelectedModel,
  isRunning,
  canSubmit,
  editing = false,
  onCancelEdit,
  onSubmit,
  onOpenSettings,
}: {
  query: string;
  setQuery: (value: string) => void;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  isRunning: boolean;
  canSubmit: boolean;
  editing?: boolean;
  onCancelEdit?: () => void;
  onSubmit: (event: FormEvent) => void;
  onOpenSettings: () => void;
}) {
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const availableModels = modelGroups.flatMap((group) => group.models);
  const selectedModelAvailable = availableModels.some((model) => model.value === selectedModel);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 42), 164)}px`;
  }, [query]);

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
        <label>
          <span>Model</span>
          <select
            value={selectedModelAvailable ? selectedModel : ''}
            onChange={(event) => setSelectedModel(event.target.value)}
            aria-label="Composer model"
            disabled={modelGroups.length === 0}
          >
            {modelGroups.length === 0 && <option value="">No connected models</option>}
            {modelGroups.map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.shortLabel}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button type="button" onClick={onOpenSettings} className="composer-settings" aria-label="Open settings">
          <Icon name="settings" size={13} /> Settings
        </button>
      </div>
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
