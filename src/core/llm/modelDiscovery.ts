import { platform } from '@platform/index';
import {
  makeModelOption,
  providerKeyName,
  providerLabel,
  PROVIDER_DEFS,
  type ModelGroup,
  type ModelOption,
} from './modelCatalog';
import { modelStrengthScore } from './modelRanking';
import { modelsUrlFor } from './providerEndpoints';
import { getOllamaHost, MOONSHOT_HOSTS, setMoonshotHost } from './providerSettings';
import { redactSecrets } from './secrets';
import { asArray, asRecord, stringArray, stringField, supportsTextChat } from './modelFilters';
import type { LlmProviderId } from './types';

export type ProviderConnectionState = 'idle' | 'checking' | 'connected' | 'no-key' | 'unavailable' | 'error';

export interface ProviderModelStatus {
  provider: LlmProviderId;
  label: string;
  state: ProviderConnectionState;
  modelCount: number;
  fetchedAt?: string;
  error?: string;
}

export interface ProviderDiscoveryResult {
  group: ModelGroup;
  status: ProviderModelStatus;
}

export interface ModelDiscoverySnapshot {
  groups: ModelGroup[];
  statuses: Record<LlmProviderId, ProviderModelStatus>;
  fetchedAt: string;
}

const DEFAULT_MODEL_LIMIT = 60;
const OPENROUTER_MODEL_LIMIT = 90;
export function initialModelStatuses(): Record<LlmProviderId, ProviderModelStatus> {
  return Object.fromEntries(
    PROVIDER_DEFS.map((def) => [
      def.provider,
      {
        provider: def.provider,
        label: def.label,
        state: 'idle',
        modelCount: 0,
      },
    ]),
  ) as Record<LlmProviderId, ProviderModelStatus>;
}

function redact(text: string, secret?: string): string {
  return redactSecrets(text, secret ? [secret] : []).slice(0, 180);
}

function safeError(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error ?? 'model discovery failed');
  return redact(message, secret);
}

// Provider HTTP is proxied through Rust (platform().llm.httpGet) so the
// guard, per-host rate limiter, and audit log cover model discovery.
async function fetchJson(
  provider: LlmProviderId,
  url: string,
  headers: Record<string, string> = {},
  secret?: string,
): Promise<unknown> {
  const { status, body } = await platform().llm.httpGet(provider, url, headers);
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status}: ${redact(body.slice(0, 240), secret)}`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('provider returned a non-JSON response');
  }
}

function recordsFromList(data: unknown): unknown[] {
  const record = asRecord(data);
  if (!record) return asArray(data);
  if (Array.isArray(record.data)) return record.data;
  if (Array.isArray(record.models)) return record.models;
  // Cloudflare answers in its own shape, with the list under `result`.
  if (Array.isArray(record.result)) return record.result;
  return [];
}

// Tool / function-calling support, read from the provider's model list where it
// is reported. Returns `undefined` when the provider does not advertise it, so
// the model stays assumed-capable rather than being demoted on a guess.
function toolSupport(provider: LlmProviderId, record: Record<string, unknown>): boolean | undefined {
  if (provider === 'openrouter') {
    const params = record.supported_parameters;
    if (Array.isArray(params)) return stringArray(params).some((p) => p.toLowerCase() === 'tools');
  }
  return undefined;
}

function optionFromRaw(provider: LlmProviderId, raw: unknown): ModelOption | null {
  const record = asRecord(raw);
  if (!record) return null;
  const id = stringField(record, 'id') ?? stringField(record, 'name') ?? stringField(record, 'model');
  if (!id || !supportsTextChat(provider, id, record)) return null;
  const displayName =
    stringField(record, 'display_name') ??
    stringField(record, 'displayName') ??
    stringField(record, 'name') ??
    stringField(record, 'description');
  const option = makeModelOption(provider, id, displayName && displayName !== id ? displayName : undefined);
  const tools = toolSupport(provider, record);
  return tools === undefined ? option : { ...option, supportsTools: tools };
}

function normalizeOptions(provider: LlmProviderId, records: unknown[]): ModelOption[] {
  const seen = new Set<string>();
  const options = records
    .map((record) => optionFromRaw(provider, record))
    .filter((option): option is ModelOption => {
      if (!option || seen.has(option.value)) return false;
      seen.add(option.value);
      return true;
    })
    .sort((a, b) => modelStrengthScore(b.value, b.label) - modelStrengthScore(a.value, a.label));
  return options.slice(0, provider === 'openrouter' ? OPENROUTER_MODEL_LIMIT : DEFAULT_MODEL_LIMIT);
}

function makeGroup(provider: LlmProviderId, models: ModelOption[]): ModelGroup {
  const keyName = providerKeyName(provider);
  const group: ModelGroup = {
    provider,
    label: providerLabel(provider),
    models,
  };
  if (keyName) group.keyName = keyName;
  return group;
}

function makeStatus(
  provider: LlmProviderId,
  state: ProviderConnectionState,
  modelCount: number,
  error?: string,
): ProviderModelStatus {
  const status: ProviderModelStatus = {
    provider,
    label: providerLabel(provider),
    state,
    modelCount,
  };
  if (state === 'connected') status.fetchedAt = new Date().toISOString();
  if (error) status.error = error;
  return status;
}

async function savedKey(provider: LlmProviderId): Promise<string | null> {
  const keyName = providerKeyName(provider);
  if (!keyName) return null;
  return platform().secrets.retrieve(keyName);
}

async function discoverOllama(): Promise<ProviderDiscoveryResult> {
  const provider: LlmProviderId = 'ollama';
  try {
    const data = await fetchJson(provider, `${getOllamaHost()}/api/tags`);
    const models = normalizeOptions(provider, recordsFromList(data));
    return {
      group: makeGroup(provider, models),
      status: makeStatus(provider, models.length > 0 ? 'connected' : 'unavailable', models.length),
    };
  } catch (error) {
    return {
      group: makeGroup(provider, []),
      status: makeStatus(provider, 'unavailable', 0, safeError(error)),
    };
  }
}

async function discoverGemini(key: string): Promise<ModelOption[]> {
  // Gemini answers a page at a time and will not say it has more unless asked:
  // without this the list stops at its default page and the newest models are
  // simply absent from the picker.
  const MAX_PAGES = 10;
  const headers = { Accept: 'application/json', 'x-goog-api-key': key };
  const records: unknown[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const data = await fetchJson('gemini', url.toString(), headers, key);
    records.push(...recordsFromList(data));
    const next = asRecord(data)?.nextPageToken;
    if (typeof next !== 'string' || next.length === 0) break;
    pageToken = next;
  }

  return normalizeOptions('gemini', records);
}

async function discoverAnthropic(key: string): Promise<ModelOption[]> {
  const data = await fetchJson(
    'anthropic',
    'https://api.anthropic.com/v1/models?limit=1000',
    {
      Accept: 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    key,
  );
  return normalizeOptions('anthropic', recordsFromList(data));
}

async function discoverOpenAiCompatible(provider: LlmProviderId, key: string): Promise<ModelOption[]> {
  const url = modelsUrlFor(provider);
  if (!url) {
    throw new Error(
      provider === 'cloudflare'
        ? 'Cloudflare needs its account id in Settings, alongside the key.'
        : `No model-list endpoint configured for ${provider}`,
    );
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${key}`,
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'hashcerebrum://local';
    headers['X-Title'] = 'HashCerebrum';
  }
  const data = await fetchJson(provider, url, headers, key);
  return normalizeOptions(provider, recordsFromList(data));
}

/**
 * Moonshot's two platforms are separate account systems at separate addresses,
 * and a key from one is refused by the other exactly as a wrong key would be.
 * The list is asked of each in turn, and the one that answers is remembered so
 * every later request goes straight there.
 */
async function discoverMoonshot(key: string): Promise<ModelOption[]> {
  let lastError: unknown;
  for (const host of MOONSHOT_HOSTS) {
    try {
      const data = await fetchJson(
        'moonshot',
        `${host}/v1/models`,
        { Accept: 'application/json', Authorization: `Bearer ${key}` },
        key,
      );
      const models = normalizeOptions('moonshot', recordsFromList(data));
      if (models.length > 0) {
        setMoonshotHost(host);
        return models;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

export async function discoverProviderModels(provider: LlmProviderId): Promise<ProviderDiscoveryResult> {
  if (provider === 'ollama') return discoverOllama();

  let key: string | null = null;
  try {
    key = await savedKey(provider);
  } catch (error) {
    return {
      group: makeGroup(provider, []),
      status: makeStatus(provider, 'error', 0, safeError(error)),
    };
  }
  if (!key) {
    return {
      group: makeGroup(provider, []),
      status: makeStatus(provider, 'no-key', 0),
    };
  }

  try {
    const models =
      provider === 'gemini'
        ? await discoverGemini(key)
        : provider === 'anthropic'
          ? await discoverAnthropic(key)
          : provider === 'moonshot'
            ? await discoverMoonshot(key)
            : await discoverOpenAiCompatible(provider, key);
    return {
      group: makeGroup(provider, models),
      status: makeStatus(provider, models.length > 0 ? 'connected' : 'unavailable', models.length),
    };
  } catch (error) {
    return {
      group: makeGroup(provider, []),
      status: makeStatus(provider, 'error', 0, safeError(error, key)),
    };
  }
}

export async function discoverConnectedModelGroups(): Promise<ModelDiscoverySnapshot> {
  const results = await Promise.all(PROVIDER_DEFS.map((def) => discoverProviderModels(def.provider)));
  const statuses = initialModelStatuses();
  for (const result of results) statuses[result.group.provider] = result.status;
  const groups = PROVIDER_DEFS.map((def) => results.find((result) => result.group.provider === def.provider)?.group)
    .filter((group): group is ModelGroup => !!group && group.models.length > 0);
  return { groups, statuses, fetchedAt: new Date().toISOString() };
}
