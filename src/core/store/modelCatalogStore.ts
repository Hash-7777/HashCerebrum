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

// Each liveness probe is a real one-token request to the provider: it counts
// against the user's rate limit, costs a fraction of a cent on a paid key, and
// on a free tier with a small daily quota it spends requests the user wanted
// for research. Probing is therefore kept small:
//  - only each provider's strongest few models, which are the ones assigned to
//    the boss and specialists (groups are strength-sorted);
//  - never a free-tier endpoint;
//  - at most once a day per model, remembered across launches.
// Anything not probed is still caught at run time, where an unusable model is
// retired for the session and failover moves on.
const PROBE_LIMIT = 4;
const PROBE_CONCURRENCY = 4;
const PROBE_FRESH_MS = 24 * 60 * 60 * 1000;
const PROBE_CACHE_KEY = 'hc_model_probe_ok_v1';
const FREE_TIER_ENDPOINT = /:free\b/i;

type ProbeCache = Record<string, number>;

function readProbeCache(): ProbeCache {
  try {
    const raw = localStorage.getItem(PROBE_CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' ? (parsed as ProbeCache) : {};
  } catch {
    return {};
  }
}

function writeProbeCache(cache: ProbeCache): void {
  try {
    localStorage.setItem(PROBE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* storage unavailable — probes simply repeat next launch */
  }
}

/** The models a refresh should probe: each cloud provider's strongest few, minus
 *  free-tier endpoints and anything that answered within the last day. */
export function probeTargets(groups: ModelGroup[], cache: ProbeCache, now: number): string[] {
  return groups
    .filter((group) => group.provider !== 'ollama')
    .flatMap((group) => group.models.slice(0, PROBE_LIMIT).map((m) => m.value))
    .filter((value) => !FREE_TIER_ENDPOINT.test(value))
    .filter((value) => !(now - (cache[value] ?? 0) < PROBE_FRESH_MS));
}

// Probe with a 1-token call and drop the models that come back definitively
// unusable. Runs in the background after a refresh (never blocks the picker
// from showing) and only ever removes models — a transient/busy failure leaves
// the model in place.
async function probeConnectedGroups(): Promise<void> {
  const cache = readProbeCache();
  const now = Date.now();
  const targets = probeTargets(useModelCatalogStore.getState().groups, cache, now);
  let condemned = false;
  for (let i = 0; i < targets.length; i += PROBE_CONCURRENCY) {
    const batch = targets.slice(i, i + PROBE_CONCURRENCY);
    const results = await Promise.all(batch.map((value) => probeModelUsable(value)));
    results.forEach((result, j) => {
      if (result === 'ok') cache[batch[j]!] = now;
      if (result === 'unusable') condemned = true;
    });
  }
  writeProbeCache(cache);
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

/** How old the model lists may get in a long-running session before the next
 *  return to the window refreshes them. */
export const CATALOG_STALE_MS = 12 * 60 * 60 * 1000;

/** Whether the lists are old enough to refresh: never fetched, or fetched more
 *  than CATALOG_STALE_MS ago, and no refresh already running. */
export function catalogIsStale(lastFetchedAt: string | null, refreshing: boolean, now: number): boolean {
  if (refreshing) return false;
  if (!lastFetchedAt) return true;
  const at = Date.parse(lastFetchedAt);
  return !Number.isFinite(at) || now - at > CATALOG_STALE_MS;
}

export function allDiscoveredModels(): ModelOption[] {
  return useModelCatalogStore.getState().groups.flatMap((group) => group.models);
}

export function labelForModelValue(value: string): string {
  return useModelCatalogStore.getState().findModel(value)?.label ?? value;
}

export function shortLabelForModelValue(value: string): string {
  return useModelCatalogStore.getState().findModel(value)?.shortLabel ?? value;
}
