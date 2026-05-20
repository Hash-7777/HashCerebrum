// Per-agent model assignment. Each agent (boss + 5 specialists) runs on a
// model. By default a model is auto-assigned from the connected catalog —
// the boss gets the strongest, specialists round-robin over the rest. The
// user can pin a specific model per agent in Settings; only those manual
// overrides are persisted.

import { create } from 'zustand';
import { AGENTS, type AgentId } from '@config/agents';
import { modelTier } from '@core/llm/failover';
import { DEFAULT_MODEL, type ModelOption } from '@core/llm/modelCatalog';
import { platform } from '@platform/index';
import { allDiscoveredModels } from './modelCatalogStore';

const STORAGE_KEY = 'agentModels.v1';

type Overrides = Partial<Record<AgentId, string>>;

interface PersistShape {
  overrides: Overrides;
}

interface AgentModelStore {
  overrides: Overrides;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setOverride: (agentId: AgentId, model: string | null) => void;
}

// Auto-assignment: boss takes the highest-tier connected model, specialists
// round-robin over the full ranked list so every agent has a model even
// when only one provider is connected.
function autoAssignModels(models: ModelOption[]): Record<AgentId, string> {
  const result = {} as Record<AgentId, string>;
  if (models.length === 0) {
    for (const agent of AGENTS) result[agent.id] = DEFAULT_MODEL;
    return result;
  }
  const ranked = [...models].sort(
    (a, b) => modelTier(b.value, b.label) - modelTier(a.value, a.label),
  );
  let cursor = 0;
  for (const agent of AGENTS) {
    if (agent.kind === 'boss') {
      result[agent.id] = ranked[0]!.value;
    } else {
      result[agent.id] = ranked[cursor % ranked.length]!.value;
      cursor += 1;
    }
  }
  return result;
}

export const useAgentModelStore = create<AgentModelStore>((set) => ({
  overrides: {},
  hydrated: false,

  hydrate: async () => {
    try {
      const stored = await platform().storage.get<PersistShape>(STORAGE_KEY);
      const overrides =
        stored?.overrides && typeof stored.overrides === 'object' ? stored.overrides : {};
      set({ overrides, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  setOverride: (agentId, model) =>
    set((state) => {
      const overrides: Overrides = { ...state.overrides };
      if (model) overrides[agentId] = model;
      else delete overrides[agentId];
      void platform()
        .storage.set<PersistShape>(STORAGE_KEY, { overrides })
        .catch(() => undefined);
      return { overrides };
    }),
}));

// Effective auto-assignment over the currently connected catalog.
export function autoAssignedModels(): Record<AgentId, string> {
  return autoAssignModels(allDiscoveredModels());
}

// The model an agent should run on right now: manual override if set,
// otherwise the auto-assigned model.
export function agentModelFor(agentId: AgentId): string {
  const override = useAgentModelStore.getState().overrides[agentId];
  if (override) return override;
  return autoAssignedModels()[agentId] ?? DEFAULT_MODEL;
}
