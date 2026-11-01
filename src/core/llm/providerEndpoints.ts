import { getCloudflareAccount, getMoonshotHost } from './providerSettings';
import type { LlmProviderId } from './types';

export const OPENAI_COMPAT_CHAT_URL: Partial<Record<LlmProviderId, string>> = {
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  cerebras: 'https://api.cerebras.ai/v1/chat/completions',
  samba: 'https://api.sambanova.ai/v1/chat/completions',
  openai: 'https://api.openai.com/v1/chat/completions',
  moonshot: 'https://api.moonshot.ai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/v1/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  nvidia: 'https://integrate.api.nvidia.com/v1/chat/completions',
  minimax: 'https://api.minimax.io/v1/chat/completions',
  xai: 'https://api.x.ai/v1/chat/completions',
  together: 'https://api.together.xyz/v1/chat/completions',
  fireworks: 'https://api.fireworks.ai/inference/v1/chat/completions',
  deepinfra: 'https://api.deepinfra.com/v1/openai/chat/completions',
  zai: 'https://api.z.ai/api/paas/v4/chat/completions',
  // The international address. The mainland one is a separate account system,
  // the way Moonshot's two are.
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  huggingface: 'https://router.huggingface.co/v1/chat/completions',
  novita: 'https://api.novita.ai/v3/openai/chat/completions',
  venice: 'https://api.venice.ai/api/v1/chat/completions',
};

export const OPENAI_COMPAT_MODELS_URL: Partial<Record<LlmProviderId, string>> = {
  groq: 'https://api.groq.com/openai/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models?output_modalities=text',
  cerebras: 'https://api.cerebras.ai/v1/models',
  samba: 'https://api.sambanova.ai/v1/models',
  openai: 'https://api.openai.com/v1/models',
  moonshot: 'https://api.moonshot.ai/v1/models',
  deepseek: 'https://api.deepseek.com/v1/models',
  mistral: 'https://api.mistral.ai/v1/models',
  nvidia: 'https://integrate.api.nvidia.com/v1/models',
  minimax: 'https://api.minimax.io/v1/models',
  xai: 'https://api.x.ai/v1/models',
  together: 'https://api.together.xyz/v1/models',
  fireworks: 'https://api.fireworks.ai/inference/v1/models',
  deepinfra: 'https://api.deepinfra.com/v1/openai/models',
  zai: 'https://api.z.ai/api/paas/v4/models',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models',
  huggingface: 'https://router.huggingface.co/v1/models',
  novita: 'https://api.novita.ai/v3/openai/models',
  venice: 'https://api.venice.ai/api/v1/models',
};

/**
 * Cloudflare is the one provider whose address is not fixed: the account id is
 * part of the path. It is built from this template and nothing else, and the
 * account id is checked to thirty-two hex characters first, so a stored value
 * can never add a host, a path or a query of its own. Its model list is in
 * Cloudflare's own shape, not the OpenAI one — a GET of `ai/v1/models`
 * answers nothing.
 */
export function cloudflareEndpoint(route: 'chat' | 'models', account: string): string | undefined {
  if (!/^[0-9a-f]{32}$/i.test(account.trim())) return undefined;
  const tail =
    route === 'chat'
      ? 'ai/v1/chat/completions'
      : 'ai/models/search?task=Text%20Generation&per_page=100';
  return `https://api.cloudflare.com/client/v4/accounts/${account.trim().toLowerCase()}/${tail}`;
}

/** The chat address for a provider, or undefined when it is not configured. */
export function chatUrlFor(provider: LlmProviderId): string | undefined {
  if (provider === 'cloudflare') return cloudflareEndpoint('chat', getCloudflareAccount());
  if (provider === 'moonshot') return `${getMoonshotHost()}/v1/chat/completions`;
  return OPENAI_COMPAT_CHAT_URL[provider];
}

/** The model-list address for a provider, or undefined when it is not configured. */
export function modelsUrlFor(provider: LlmProviderId): string | undefined {
  if (provider === 'cloudflare') return cloudflareEndpoint('models', getCloudflareAccount());
  if (provider === 'moonshot') return `${getMoonshotHost()}/v1/models`;
  return OPENAI_COMPAT_MODELS_URL[provider];
}
