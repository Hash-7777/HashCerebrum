import type { LlmProvider } from './types';
import { anthropic } from './providers/anthropic';
import { openai } from './providers/openai';
import { ollama } from './providers/ollama';

// Single source of truth for LLM providers. Add new ones here and in
// CSP connect-src + security::policy::ALLOWED_HOSTS on the Rust side.
const PROVIDERS: Record<LlmProvider['id'], LlmProvider> = {
  anthropic,
  openai,
  ollama,
};

export function getProvider(id: LlmProvider['id']): LlmProvider {
  return PROVIDERS[id];
}

export function listProviders(): LlmProvider[] {
  return Object.values(PROVIDERS);
}
