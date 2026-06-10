// Per-agent model assignment. Each agent (boss + 5 specialists) runs on a
// model. By default a model is auto-assigned from the connected catalog —
// the boss gets the strongest, specialists round-robin over the rest. The
// user can pin a specific model per agent in Settings; only those manual
// overrides are persisted.

import { create } from 'zustand';
import { AGENTS, type AgentId } from '@config/agents';
import { deadProvidersThisSession } from '@core/llm/failover';
import { modelStrengthScore } from '@core/llm/modelRanking';
import { DEFAULT_MODEL, parseModelRef, type ModelOption } from '@core/llm/modelCatalog';
import { platform } from '@platform/index';
import { showToast } from './toastStore';
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
// weighs capability tier *and* parameter size.
//
// Specialists are spread across DISTINCT providers (round-robin over providers,
// strongest first) rather than over a flat model list. With several keys
// connected this means each specialist runs on a different provider, so a swarm
// no longer burns one key into rate limits — the cause of the cascading 429s in
// long runs. When only one provider is connected they all share it as before.
function isCompleteAgentMap(map: Partial<Record<AgentId, string>>): map is Record<AgentId, string> {
  return AGENTS.every((agent) => typeof map[agent.id] === 'string');
}

// OpenRouter-style ":free" endpoints are throttled to a few requests per minute,
// so on a long hot path (boss synthesis, manuscript drafting across many
// sections) they 429 and cascade. The penalty keeps a smaller, reliable model as
// the auto-pick while leaving the free model selectable manually and usable as a
// last-resort failover. Applied only here — the discovery catalog still ranks by
// pure capability via modelStrengthScore.
const FREE_TIER_ENDPOINT = /:free\b/i;
function selectionScore(model: ModelOption): number {
  const base = modelStrengthScore(model.value, model.label);
  return FREE_TIER_ENDPOINT.test(model.value) ? base - 250 : base;
}

export function autoAssignModels(models: ModelOption[]): Record<AgentId, string> {
  const result: Partial<Record<AgentId, string>> = {};
  if (models.length === 0) {
    for (const agent of AGENTS) result[agent.id] = DEFAULT_MODEL;
    if (!isCompleteAgentMap(result)) throw new Error('autoAssignModels failed to populate all agents');
    return result;
  }
  // Exclude providers that are dead-for-session (hard 402 / no credits) so we
  // never auto-assign an unfunded provider. If that empties the pool, fall back
  // to all models rather than break.
  const dead = deadProvidersThisSession();
  const alive = models.filter((model) => !dead.has(parseModelRef(model.value).provider));
  const alivePool = alive.length > 0 ? alive : models;
  // Every agent here calls tools (the boss orchestrates + synthesises, the
  // specialists query sources), so exclude models we positively know lack tool
  // calling. Unknown (`supportsTools === undefined`) stays in — we never demote
  // on a guess. If that would empty the pool, keep all models rather than break.
  const toolCapable = alivePool.filter((model) => model.supportsTools !== false);
  const pool = toolCapable.length > 0 ? toolCapable : alivePool;
  const ranked = [...pool].sort((a, b) => selectionScore(b) - selectionScore(a));
  // Group ranked models by provider, preserving strength order; providers are
  // ordered by their strongest model (insertion order of `ranked`).
  const byProvider = new Map<string, ModelOption[]>();
  for (const model of ranked) {
    const provider = parseModelRef(model.value).provider;
    const list = byProvider.get(provider);
    if (list) list.push(model);
    else byProvider.set(provider, [model]);
  }
  const providers = [...byProvider.keys()];
  const cursorByProvider = new Map<string, number>();
  const nextFrom = (provider: string): string => {
    const list = byProvider.get(provider)!;
    const i = cursorByProvider.get(provider) ?? 0;
    cursorByProvider.set(provider, i + 1);
    return list[i % list.length]!.value;
  };

  // Start specialists on the second provider when more than one is connected,
  // so the boss's (strongest) provider isn't immediately doubled up.
  let provIdx = providers.length > 1 ? 1 : 0;
  for (const agent of AGENTS) {
    if (agent.kind === 'boss') {
      result[agent.id] = ranked[0]!.value; // strongest model overall
    } else {
      const provider = providers[provIdx % providers.length]!;
      result[agent.id] = nextFrom(provider);
      provIdx += 1;
    }
  }
  if (!isCompleteAgentMap(result)) throw new Error('autoAssignModels failed to populate all agents');
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
    } catch (error) {
      console.warn('[agentModelStore] Failed to load persisted overrides:', error);
      showToast('Failed to load model assignments', 'error');
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
        .catch((err: unknown) => {
          console.error('[agentModelStore] persist failed:', err);
        });
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
