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
};
