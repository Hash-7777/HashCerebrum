// Per-agent model assignment. Each agent (boss + 5 specialists) runs on a
// model. By default a model is auto-assigned from the connected catalog —
// the boss gets the strongest, specialists round-robin over the rest. The
// user can pin a specific model per agent in Settings; only those manual
// overrides are persisted.

import { create } from 'zustand';
import { AGENTS, type AgentId } from '@config/agents';
import { modelStrengthScore } from '@core/llm/modelRanking';
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

// Auto-assignment: the boss writes the synthesis and the manuscript, so it
// takes the strongest connected model — ranked by modelStrengthScore, which
// weighs capability tier *and* parameter size. The coarse failover tier is
// not used here because it cannot tell, say, a 17B model from a 70B one of
// the same family. Specialists round-robin over the full ranked list so
// every agent has a model even when only one provider is connected.
function autoAssignModels(models: ModelOption[]): Record<AgentId, string> {
  const result = {} as Record<AgentId, string>;
  if (models.length === 0) {
    for (const agent of AGENTS) result[agent.id] = DEFAULT_MODEL;
    return result;
  }
  const ranked = [...models].sort(
    (a, b) => modelStrengthScore(b.value, b.label) - modelStrengthScore(a.value, a.label),
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

export function isConnectedModelValue(value: string, models: ModelOption[] = allDiscoveredModels()): boolean {
  return models.some((model) => model.value === value);
}

// Effective auto-assignment over the currently connected catalog.
export function autoAssignedModels(): Record<AgentId, string> {
  return autoAssignModels(allDiscoveredModels());
}

// The model an agent should run on right now: manual override if set,
// otherwise the auto-assigned model. Stale overrides are ignored so a
// removed provider/model cannot keep an agent pinned to an unavailable
// model after model discovery refreshes.
export function agentModelFor(agentId: AgentId): string {
  const discovered = allDiscoveredModels();
  const override = useAgentModelStore.getState().overrides[agentId];
  if (override && isConnectedModelValue(override, discovered)) return override;
  return autoAssignModels(discovered)[agentId] ?? DEFAULT_MODEL;
}
