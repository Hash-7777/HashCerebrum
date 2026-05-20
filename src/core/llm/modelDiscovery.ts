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
import { OPENAI_COMPAT_MODELS_URL } from './providerEndpoints';
import { getOllamaHost } from './providerSettings';
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
const NON_CHAT_MODEL = /\b(embed|embedding|rerank|moderation|safeguard|guard|image|tts|whisper|transcrib|realtime|ocr|sora|deep-research|computer-use|codex|babbage|davinci)\b/i;

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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function boolField(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function redact(text: string, secret?: string): string {
  let clean = text
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(api[_ -]?key["':=\s]+)[A-Za-z0-9._~+/=-]+/gi, '$1[redacted]');
  if (secret) clean = clean.split(secret).join('[redacted]');
  return clean.slice(0, 180);
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
  return [];
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  return asRecord(record[key]);
}

function stringArray(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

function supportsTextChat(provider: LlmProviderId, id: string, record: Record<string, unknown>): boolean {
  if (NON_CHAT_MODEL.test(id)) return false;
  if (boolField(record, 'archived') === true || boolField(record, 'deprecated') === true) return false;

  if (provider === 'gemini') {
    const methods = stringArray(record.supportedGenerationMethods).map((method) => method.toLowerCase());
    return methods.some((method) => method === 'generatecontent' || method === 'streamgeneratecontent');
  }

  if (provider === 'mistral') {
    const capabilities = nestedRecord(record, 'capabilities');
    if (capabilities && boolField(capabilities, 'completion_chat') === false) return false;
  }

  if (provider === 'openrouter') {
    const architecture = nestedRecord(record, 'architecture');
    const modality = architecture ? stringField(architecture, 'modality') : undefined;
    const outputModalities = architecture ? stringArray(architecture.output_modalities) : [];
    if (outputModalities.length > 0 && !outputModalities.some((item) => item.toLowerCase() === 'text')) return false;
    if (modality && !modality.toLowerCase().includes('text')) return false;
  }

  return true;
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
  return makeModelOption(provider, id, displayName && displayName !== id ? displayName : undefined);
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
  return platform().keychain.retrieve(keyName);
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
  const data = await fetchJson(
    'gemini',
    'https://generativelanguage.googleapis.com/v1beta/models',
    {
      Accept: 'application/json',
      'x-goog-api-key': key,
    },
    key,
  );
  return normalizeOptions('gemini', recordsFromList(data));
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
  const url = OPENAI_COMPAT_MODELS_URL[provider];
  if (!url) throw new Error(`No model-list endpoint configured for ${provider}`);
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
