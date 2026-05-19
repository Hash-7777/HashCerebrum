import type { FormEvent } from 'react';
import { Icon } from '@ui/icons';
import { MODEL_GROUPS } from '@core/llm/modelCatalog';

const isMac = typeof navigator !== 'undefined' && /Mac|iP/i.test(navigator.platform);
const shortcut = isMac ? '⌘ ⏎' : 'Ctrl ⏎';

export function Composer({
  query,
  setQuery,
  selectedModel,
  setSelectedModel,
  isRunning,
  canSubmit,
  onSubmit,
  onOpenSettings,
}: {
  query: string;
  setQuery: (value: string) => void;
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  isRunning: boolean;
  canSubmit: boolean;
  onSubmit: (event: FormEvent) => void;
  onOpenSettings: () => void;
}) {
  return (
    <form className="research-composer" onSubmit={onSubmit}>
      <div className="composer-controls">
        <label>
          <span>Model</span>
          <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} aria-label="Composer model">
            {MODEL_GROUPS.map((group) => (
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
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ask about a disease, drug, clinical trial, biomarker, or safety signal"
          rows={3}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              if (canSubmit && !isRunning) onSubmit(event as unknown as FormEvent);
            }
          }}
        />
        <span className="composer-hint" aria-hidden="true">{shortcut} to send</span>
        <button
          type="submit"
          disabled={isRunning || !canSubmit}
          className="composer-send"
          data-running={isRunning ? 'true' : 'false'}
          aria-label={isRunning ? 'Running' : 'Research'}
        >
          <Icon name={isRunning ? 'spinner' : 'send'} size={13} />
          <span>{isRunning ? 'Running' : 'Research'}</span>
        </button>
      </div>
    </form>
  );
}
