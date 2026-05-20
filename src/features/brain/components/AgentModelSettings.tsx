// Settings section — assign an LLM model to the boss and each specialist.
// Every agent auto-picks a connected model; this lets the user pin one.

import { AGENTS } from '@config/agents';
import { useModelCatalogStore, labelForModelValue } from '@core/store/modelCatalogStore';
import { autoAssignedModels, useAgentModelStore } from '@core/store/agentModelStore';

export function AgentModelSettings() {
  const modelGroups = useModelCatalogStore((s) => s.groups);
  const overrides = useAgentModelStore((s) => s.overrides);
  const setOverride = useAgentModelStore((s) => s.setOverride);
  const auto = autoAssignedModels();

  return (
    <section className="settings-agents" aria-label="Agent models">
      <header>
        <strong>Agent models</strong>
      </header>
      <p className="settings-agents-hint">
        The boss and each specialist auto-pick a connected model. Override any of them here.
      </p>
      {AGENTS.map((agent) => (
        <label key={agent.id} className="settings-agent-row">
          <span className="settings-agent-name" title={agent.specialty}>
            {agent.label}
          </span>
          <select
            value={overrides[agent.id] ?? ''}
            onChange={(event) => setOverride(agent.id, event.target.value || null)}
            disabled={modelGroups.length === 0}
          >
            <option value="">Auto — {labelForModelValue(auto[agent.id] ?? '')}</option>
            {modelGroups.map((group) => (
              <optgroup key={group.provider} label={group.label}>
                {group.models.map((model) => (
                  <option key={model.value} value={model.value}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ))}
    </section>
  );
}
