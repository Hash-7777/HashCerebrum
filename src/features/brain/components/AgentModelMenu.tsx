// Title-bar model menu: one click from anywhere to see which model each agent
// runs on and change it. The same per-agent choices as Settings → Agent models
// (they share AgentModelRow and the agent-model store), so the two can never
// disagree. The button names the lead agent's current model, so the model in
// charge is always visible.

import { useEffect, useRef, useState } from 'react';
import { AGENTS } from '@config/agents';
import { useModelCatalogStore, shortLabelForModelValue } from '@core/store/modelCatalogStore';
import { agentModelFor, autoAssignedModels, useAgentModelStore } from '@core/store/agentModelStore';
import { AgentModelRow } from './AgentModelSettings';

/** A model chip: a die with a neural mark inside and pins on each side. */
function ModelGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
      <path d="M9 3.5v2.5M15 3.5v2.5M9 18v2.5M15 18v2.5M3.5 9h2.5M3.5 15h2.5M18 9h2.5M18 15h2.5" />
      <circle cx="10" cy="10.5" r="1" />
      <circle cx="14.2" cy="12.2" r="1" />
      <circle cx="10.6" cy="14.6" r="1" />
      <path d="M10.9 10.9l2.4 1M13.6 13l-2.2 1.3" />
    </svg>
  );
}

export function AgentModelMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const overrides = useAgentModelStore((s) => s.overrides);
  const setOverride = useAgentModelStore((s) => s.setOverride);
  // Recomputed on each render; the store subscriptions above re-render on change.
  const auto = autoAssignedModels();
  const leadModel = agentModelFor('boss');

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const leadLabel = modelGroups.length > 0 ? shortLabelForModelValue(leadModel) : 'No models';

  return (
    <div className="model-menu" ref={rootRef}>
      <button
        type="button"
        className="model-menu-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Models for each agent"
        onClick={() => setOpen((v) => !v)}
      >
        <ModelGlyph />
        <span className="model-menu-label">{leadLabel}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="model-menu-panel" role="dialog" aria-label="Agent models">
          <header>
            <strong>Agent models</strong>
            <span>Each agent picks a connected model on its own. Choose one to pin it.</span>
          </header>
          {modelGroups.length === 0 ? (
            <p className="model-menu-empty">No models yet. Add a provider key in Settings, or start Ollama.</p>
          ) : (
            <div className="model-menu-rows">
              {AGENTS.map((agent) => (
                <AgentModelRow
                  key={agent.id}
                  label={agent.id === 'boss' ? 'Lead agent' : agent.label}
                  specialty={agent.specialty}
                  value={overrides[agent.id] ?? ''}
                  autoValue={auto[agent.id] ?? ''}
                  modelGroups={modelGroups}
                  onChange={(value) => setOverride(agent.id, value || null)}
                />
              ))}
            </div>
          )}
          <button
            type="button"
            className="model-menu-more"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent('hc:open-settings'));
            }}
          >
            Provider keys and all settings
          </button>
        </div>
      )}
    </div>
  );
}
