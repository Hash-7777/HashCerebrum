import { create } from 'zustand';
import { PROVIDER_DEFS, type ModelGroup, type ModelOption } from '@core/llm/modelCatalog';
import {
  discoverConnectedModelGroups,
  discoverProviderModels,
  initialModelStatuses,
  type ProviderModelStatus,
} from '@core/llm/modelDiscovery';
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
        groups: sortGroups(snapshot.groups),
        statuses: snapshot.statuses,
        lastFetchedAt: snapshot.fetchedAt,
      }));
    } finally {
      set((state) => ({ ...state, refreshing: false }));
    }
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
        groups,
        statuses: { ...state.statuses, [provider]: result.status },
        lastFetchedAt: new Date().toISOString(),
      };
    });
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
