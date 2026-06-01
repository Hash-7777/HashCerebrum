// Static configuration. Anything tunable at runtime lives in the store,
// not here. These values fail loud if changed accidentally.

export const APP_NAME = 'HashCerebrum';
export const APP_VERSION = '1.1.0';

// Hard caps — enforced by the type system in modes.ts and agents.ts.
// Raising these requires updating the tuple literal AND the readme.
// Unbounded module growth is locked out at compile time here.
export const MAX_MODES = 5 as const;
export const MAX_AGENTS = 8 as const;

// Keychain key names. Used by platform/tauri/keychain.ts on both sides.
export const KEY = {
  anthropic: 'llm.anthropic',
  openai: 'llm.openai',
  ncbi: 'medical.ncbi_entrez',
} as const;
