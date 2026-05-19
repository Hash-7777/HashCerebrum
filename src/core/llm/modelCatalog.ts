import type { LlmProviderId } from './types';

export interface ModelOption {
  value: string;
  label: string;
  shortLabel: string;
}

export interface ModelGroup {
  provider: LlmProviderId;
  label: string;
  keyName?: string;
  models: ModelOption[];
}

export interface ProviderDef {
  provider: LlmProviderId;
  label: string;
  kind: 'local' | 'cloud';
  keyName?: string;
}

export const PROVIDER_DEFS: ProviderDef[] = [
  {
    provider: 'ollama',
    label: 'Ollama local',
    kind: 'local',
  },
  {
    provider: 'groq',
    label: 'Groq',
    keyName: 'llm.groq',
    kind: 'cloud',
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    keyName: 'llm.gemini',
    kind: 'cloud',
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    keyName: 'llm.openrouter',
    kind: 'cloud',
  },
  {
    provider: 'cerebras',
    label: 'Cerebras',
    keyName: 'llm.cerebras',
    kind: 'cloud',
  },
  {
    provider: 'samba',
    label: 'SambaNova',
    keyName: 'llm.samba',
    kind: 'cloud',
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    keyName: 'llm.openai',
    kind: 'cloud',
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    keyName: 'llm.anthropic',
    kind: 'cloud',
  },
  {
    provider: 'moonshot',
    label: 'Moonshot / Kimi',
    keyName: 'llm.moonshot',
    kind: 'cloud',
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    keyName: 'llm.deepseek',
    kind: 'cloud',
  },
  {
    provider: 'mistral',
    label: 'Mistral',
    keyName: 'llm.mistral',
    kind: 'cloud',
  },
  {
    provider: 'nvidia',
    label: 'NVIDIA NIM',
    keyName: 'llm.nvidia',
    kind: 'cloud',
  },
];

export const MODEL_GROUPS: ModelGroup[] = PROVIDER_DEFS.map((def) => {
  const group: ModelGroup = {
    provider: def.provider,
    label: def.label,
    models: [],
  };
  if (def.keyName) group.keyName = def.keyName;
  return group;
});

export interface ParsedModelRef {
  kind: 'local' | 'cloud';
  provider: LlmProviderId;
  model: string;
}

export function parseModelRef(value: string): ParsedModelRef {
  const [kind, provider, ...rest] = value.split(':');
  if ((kind !== 'local' && kind !== 'cloud') || !provider || rest.length === 0) {
    return { kind: 'local', provider: 'ollama', model: 'llama3.2' };
  }
  return { kind, provider: provider as LlmProviderId, model: rest.join(':') };
}

export function providerKeyName(provider: LlmProviderId): string | undefined {
  return PROVIDER_DEFS.find((group) => group.provider === provider)?.keyName;
}

export function providerLabel(provider: LlmProviderId): string {
  return PROVIDER_DEFS.find((group) => group.provider === provider)?.label ?? provider;
}

export function providerKind(provider: LlmProviderId): 'local' | 'cloud' {
  return PROVIDER_DEFS.find((group) => group.provider === provider)?.kind ?? 'cloud';
}

export function modelValue(provider: LlmProviderId, modelId: string): string {
  return `${providerKind(provider)}:${provider}:${modelId}`;
}

export function humanizeModelId(modelId: string): string {
  return modelId
    .replace(/^models\//, '')
    .replace(/[:/_-]+/g, ' ')
    .replace(/\b(\d+)b\b/gi, '$1B')
    .replace(/\bgpt\b/gi, 'GPT')
    .replace(/\bllm\b/gi, 'LLM')
    .replace(/\bapi\b/gi, 'API')
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

export function makeModelOption(provider: LlmProviderId, modelId: string, displayName?: string): ModelOption {
  const cleanId = modelId.replace(/^models\//, '').trim();
  const shortLabel = (displayName?.trim() || humanizeModelId(cleanId)).slice(0, 72);
  return {
    value: modelValue(provider, cleanId),
    label: `${shortLabel} · ${providerLabel(provider)}`,
    shortLabel,
  };
}

export const DEFAULT_LOCAL_MODEL_ID = 'llama3.2';
export const DEFAULT_MODEL = modelValue('ollama', DEFAULT_LOCAL_MODEL_ID);
