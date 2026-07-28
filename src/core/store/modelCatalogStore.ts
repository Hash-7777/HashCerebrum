import { create } from 'zustand';
import { PROVIDER_DEFS, type ModelGroup, type ModelOption } from '@core/llm/modelCatalog';
import {
  discoverConnectedModelGroups,
  discoverProviderModels,
  initialModelStatuses,
  type ProviderModelStatus,
} from '@core/llm/modelDiscovery';
import { unusableModelValues } from '@core/llm/failover';
// Imported statically. It was previously pulled in with a dynamic `import()`
// inside probeConnectedGroups to keep it out of this chunk, but the module is
// also statically imported by BrainMode, SettingsPanel, boss, paperPipeline and
// the query planner — so it was always already in the graph, the split never
// happened, and every build logged an INEFFECTIVE_DYNAMIC_IMPORT warning that
// buried the ones worth reading.
import { probeModelUsable } from '@core/llm/ProviderRegistry';
import type { LlmProviderId } from '@core/llm/types';

interface ModelCatalogStore {
  groups: ModelGroup[];
  statuses: Record<LlmProviderId, ProviderModelStatus>;
  hydrated: boolean;
  refreshing: boolean;
  lastFetchedAt: string | null;
  refreshAll: () => Promise<void>;
  refreshProvider: (provider: LlmProviderId) => Promise<ProviderModelStatus>;
  removeProvider: (provider: LlmProviderId) => void;
  findModel: (value: string) => ModelOption | null;
}

function sortGroups(groups: ModelGroup[]): ModelGroup[] {
  const order = new Map(PROVIDER_DEFS.map((def, index) => [def.provider, index]));
  return [...groups].sort((a, b) => (order.get(a.provider) ?? 999) - (order.get(b.provider) ?? 999));
}

// Drop models already known to be gone/inaccessible this session (runtime
// failures or a prior probe), and any group left empty. Applied every time
// groups are set so a model condemned at runtime disappears on the next refresh.
function pruneUnusable(groups: ModelGroup[]): ModelGroup[] {
  const dead = unusableModelValues();
  if (dead.size === 0) return groups;
  return groups
    .map((group) => ({ ...group, models: group.models.filter((m) => !dead.has(m.value)) }))
    .filter((group) => group.models.length > 0);
}

// How many of each provider's strongest models to liveness-probe on a refresh.
// Groups are strength-sorted, so this covers the models actually offered to the
// boss and specialists; anything past it is still caught at runtime.
const PROBE_LIMIT = 16;
const PROBE_CONCURRENCY = 4;

// Probe the top models of every connected cloud provider with a 1-token call and
// drop the ones that come back definitively unusable. Runs in the background
// after a refresh (never blocks the picker from showing) and only ever removes
// models — a transient/busy failure leaves the model in place.
async function probeConnectedGroups(): Promise<void> {
  const groups = useModelCatalogStore.getState().groups;
  const targets = groups
    .filter((group) => group.provider !== 'ollama')
    .flatMap((group) => group.models.slice(0, PROBE_LIMIT).map((m) => m.value));
  let condemned = false;
  for (let i = 0; i < targets.length; i += PROBE_CONCURRENCY) {
    const batch = targets.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.all(batch.map((value) => probeModelUsable(value)));
    if (results.includes('unusable')) condemned = true;
  }
  if (condemned) {
    useModelCatalogStore.setState((state) => ({ ...state, groups: pruneUnusable(state.groups) }));
  }
}

export const useModelCatalogStore = create<ModelCatalogStore>((set, get) => ({
  groups: [],
  statuses: initialModelStatuses(),
  hydrated: false,
  refreshing: false,
  lastFetchedAt: null,

  refreshAll: async () => {
    set((state) => ({
      ...state,
      refreshing: true,
      hydrated: true,
      statuses: Object.fromEntries(
        PROVIDER_DEFS.map((def) => [
          def.provider,
          { provider: def.provider, label: def.label, state: 'checking', modelCount: 0 },
        ]),
      ) as Record<LlmProviderId, ProviderModelStatus>,
    }));
    try {
      const snapshot = await discoverConnectedModelGroups();
      set((state) => ({
        ...state,
        groups: pruneUnusable(sortGroups(snapshot.groups)),
        statuses: snapshot.statuses,
        lastFetchedAt: snapshot.fetchedAt,
      }));
    } finally {
      set((state) => ({ ...state, refreshing: false }));
    }
    void probeConnectedGroups();
  },

  refreshProvider: async (provider) => {
    set((state) => ({
      ...state,
      statuses: {
        ...state.statuses,
        [provider]: {
          provider,
          label: state.statuses[provider]?.label ?? provider,
          state: 'checking',
          modelCount: 0,
        },
      },
    }));
    const result = await discoverProviderModels(provider);
    set((state) => {
      const withoutProvider = state.groups.filter((group) => group.provider !== provider);
      const groups = result.group.models.length > 0 ? sortGroups([...withoutProvider, result.group]) : withoutProvider;
      return {
        ...state,
        groups: pruneUnusable(groups),
        statuses: { ...state.statuses, [provider]: result.status },
        lastFetchedAt: new Date().toISOString(),
      };
    });
    void probeConnectedGroups();
    return result.status;
  },

  removeProvider: (provider) =>
    set((state) => ({
      ...state,
      groups: state.groups.filter((group) => group.provider !== provider),
      statuses: {
        ...state.statuses,
        [provider]: {
          provider,
          label: state.statuses[provider]?.label ?? provider,
          state: 'no-key',
          modelCount: 0,
        },
      },
    })),

  findModel: (value) => {
    for (const group of get().groups) {
      const model = group.models.find((option) => option.value === value);
      if (model) return model;
    }
    return null;
  },
}));

export function allDiscoveredModels(): ModelOption[] {
  return useModelCatalogStore.getState().groups.flatMap((group) => group.models);
}

export function labelForModelValue(value: string): string {
  return useModelCatalogStore.getState().findModel(value)?.label ?? value;
}

export function shortLabelForModelValue(value: string): string {
  return useModelCatalogStore.getState().findModel(value)?.shortLabel ?? value;
}
