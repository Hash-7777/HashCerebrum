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

export const MODEL_GROUPS: ModelGroup[] = [
  {
    provider: 'ollama',
    label: 'Ollama local',
    models: [
      { value: 'local:ollama:llama3.2', label: 'Llama 3.2 · Ollama', shortLabel: 'Llama 3.2' },
      { value: 'local:ollama:qwen2.5', label: 'Qwen 2.5 · Ollama', shortLabel: 'Qwen 2.5' },
      { value: 'local:ollama:gemma2', label: 'Gemma 2 · Ollama', shortLabel: 'Gemma 2' },
    ],
  },
  {
    provider: 'groq',
    label: 'Groq',
    keyName: 'llm.groq',
    models: [
      { value: 'cloud:groq:openai/gpt-oss-120b', label: 'GPT OSS 120B · Groq', shortLabel: 'GPT OSS 120B' },
      { value: 'cloud:groq:llama-3.3-70b-versatile', label: 'Llama 3.3 70B · Groq', shortLabel: 'Llama 3.3 70B' },
      { value: 'cloud:groq:llama-3.1-8b-instant', label: 'Llama 3.1 8B · Groq', shortLabel: 'Llama 3.1 8B' },
    ],
  },
  {
    provider: 'gemini',
    label: 'Google Gemini',
    keyName: 'llm.gemini',
    models: [
      { value: 'cloud:gemini:gemini-2.5-flash', label: 'Gemini 2.5 Flash · Google', shortLabel: 'Gemini 2.5 Flash' },
      { value: 'cloud:gemini:gemini-2.5-pro', label: 'Gemini 2.5 Pro · Google', shortLabel: 'Gemini 2.5 Pro' },
      { value: 'cloud:gemini:gemini-2.0-flash', label: 'Gemini 2.0 Flash · Google', shortLabel: 'Gemini 2.0 Flash' },
    ],
  },
  {
    provider: 'openrouter',
    label: 'OpenRouter',
    keyName: 'llm.openrouter',
    models: [
      { value: 'cloud:openrouter:openai/gpt-oss-120b:free', label: 'GPT OSS 120B free · OpenRouter', shortLabel: 'GPT OSS 120B free' },
      { value: 'cloud:openrouter:deepseek/deepseek-r1:free', label: 'DeepSeek R1 free · OpenRouter', shortLabel: 'DeepSeek R1 free' },
      { value: 'cloud:openrouter:meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B free · OpenRouter', shortLabel: 'Llama 3.3 70B free' },
    ],
  },
  {
    provider: 'cerebras',
    label: 'Cerebras',
    keyName: 'llm.cerebras',
    models: [
      { value: 'cloud:cerebras:llama-3.3-70b', label: 'Llama 3.3 70B · Cerebras', shortLabel: 'Llama 3.3 70B' },
      { value: 'cloud:cerebras:llama3.1-8b', label: 'Llama 3.1 8B · Cerebras', shortLabel: 'Llama 3.1 8B' },
    ],
  },
  {
    provider: 'samba',
    label: 'SambaNova',
    keyName: 'llm.samba',
    models: [
      { value: 'cloud:samba:Llama-4-Maverick-17B-128E-Instruct', label: 'Llama 4 Maverick · SambaNova', shortLabel: 'Llama 4 Maverick' },
      { value: 'cloud:samba:Meta-Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B · SambaNova', shortLabel: 'Llama 3.3 70B' },
      { value: 'cloud:samba:DeepSeek-R1', label: 'DeepSeek R1 · SambaNova', shortLabel: 'DeepSeek R1' },
    ],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    keyName: 'llm.openai',
    models: [
      { value: 'cloud:openai:gpt-4o', label: 'GPT-4o · OpenAI', shortLabel: 'GPT-4o' },
      { value: 'cloud:openai:gpt-4o-mini', label: 'GPT-4o Mini · OpenAI', shortLabel: 'GPT-4o Mini' },
      { value: 'cloud:openai:o3-mini', label: 'o3 Mini · OpenAI', shortLabel: 'o3 Mini' },
    ],
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    keyName: 'llm.anthropic',
    models: [
      { value: 'cloud:anthropic:claude-sonnet-4-20250514', label: 'Claude Sonnet 4 · Anthropic', shortLabel: 'Claude Sonnet 4' },
      { value: 'cloud:anthropic:claude-opus-4-20250514', label: 'Claude Opus 4 · Anthropic', shortLabel: 'Claude Opus 4' },
      { value: 'cloud:anthropic:claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet · Anthropic', shortLabel: 'Claude 3.5 Sonnet' },
    ],
  },
  {
    provider: 'moonshot',
    label: 'Moonshot / Kimi',
    keyName: 'llm.moonshot',
    models: [
      { value: 'cloud:moonshot:kimi-k2.6', label: 'Kimi K2.6 · Moonshot', shortLabel: 'Kimi K2.6' },
      { value: 'cloud:moonshot:kimi-k2-thinking', label: 'Kimi K2 Thinking · Moonshot', shortLabel: 'Kimi Thinking' },
      { value: 'cloud:moonshot:moonshot-v1-128k', label: 'Moonshot v1 128K · Kimi', shortLabel: 'Kimi 128K' },
    ],
  },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    keyName: 'llm.deepseek',
    models: [
      { value: 'cloud:deepseek:deepseek-chat', label: 'DeepSeek V3 · DeepSeek', shortLabel: 'DeepSeek V3' },
      { value: 'cloud:deepseek:deepseek-reasoner', label: 'DeepSeek R1 · DeepSeek', shortLabel: 'DeepSeek R1' },
    ],
  },
  {
    provider: 'mistral',
    label: 'Mistral',
    keyName: 'llm.mistral',
    models: [
      { value: 'cloud:mistral:mistral-large-latest', label: 'Mistral Large · Mistral', shortLabel: 'Mistral Large' },
      { value: 'cloud:mistral:codestral-latest', label: 'Codestral · Mistral', shortLabel: 'Codestral' },
      { value: 'cloud:mistral:mistral-medium-latest', label: 'Mistral Medium · Mistral', shortLabel: 'Mistral Medium' },
    ],
  },
  {
    provider: 'nvidia',
    label: 'NVIDIA NIM',
    keyName: 'llm.nvidia',
    models: [
      { value: 'cloud:nvidia:meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B · NVIDIA', shortLabel: 'Llama 3.3 70B' },
      { value: 'cloud:nvidia:nvidia/llama-3.1-nemotron-ultra-253b-v1', label: 'Nemotron Ultra 253B · NVIDIA', shortLabel: 'Nemotron Ultra' },
      { value: 'cloud:nvidia:deepseek-ai/deepseek-v3.1-terminus', label: 'DeepSeek V3.1 · NVIDIA', shortLabel: 'DeepSeek V3.1' },
    ],
  },
];

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
  return MODEL_GROUPS.find((group) => group.provider === provider)?.keyName;
}

export const DEFAULT_MODEL = MODEL_GROUPS[0]!.models[0]!.value;
