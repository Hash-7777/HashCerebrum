// Settings section — assign an LLM model to the boss and each specialist.
// Every agent auto-picks a connected model; this lets the user pin one.

import { AGENTS } from '@config/agents';
import { useModelCatalogStore, labelForModelValue } from '@core/store/modelCatalogStore';
import { autoAssignedModels, isConnectedModelValue, useAgentModelStore } from '@core/store/agentModelStore';

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
        <AgentModelRow
          key={agent.id}
          label={agent.label}
          specialty={agent.specialty}
          value={overrides[agent.id] ?? ''}
          autoValue={auto[agent.id] ?? ''}
          modelGroups={modelGroups}
          onChange={(value) => setOverride(agent.id, value || null)}
        />
      ))}
    </section>
  );
}

export function AgentModelRow({
  label,
  specialty,
  value,
  autoValue,
  modelGroups,
  onChange,
}: {
  label: string;
  specialty: string;
  value: string;
  autoValue: string;
  modelGroups: ReturnType<typeof useModelCatalogStore.getState>['groups'];
  onChange: (value: string) => void;
}) {
  const allModels = modelGroups.flatMap((group) => group.models);
  const staleOverride = value && !isConnectedModelValue(value, allModels);

  return (
    <label className="settings-agent-row">
      <span className="settings-agent-name" title={specialty}>
        {label}
      </span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={modelGroups.length === 0}>
        <option value="">Auto — {labelForModelValue(autoValue)}</option>
        {staleOverride && (
          <option value={value} disabled>
            Unavailable — using Auto
          </option>
        )}
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
  );
}
