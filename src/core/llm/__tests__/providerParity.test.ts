// Every provider the app offers must be reachable, and nothing else must be.
//
// A provider is spread across four places: the id union, the catalogue the
// Settings list is built from, the addresses, and the Rust guard's allowlist.
// Miss one and the failure is quiet in a different way each time — a provider
// with no address throws only once a model is chosen, and a provider the guard
// does not know is refused only after a key has been saved and a question
// asked. So the four are checked against each other here, including against
// the Rust file itself.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROVIDER_DEFS } from '../modelCatalog';
import { OPENAI_COMPAT_CHAT_URL, OPENAI_COMPAT_MODELS_URL, chatUrlFor, cloudflareEndpoint, modelsUrlFor } from '../providerEndpoints';
import {
  MOONSHOT_HOSTS,
  normalizeCloudflareAccount,
  setCloudflareAccount,
  setMoonshotHost,
} from '../providerSettings';
import type { LlmProviderId } from '../types';

// The settings module reads the browser's store; this file runs in node so it
// can read the Rust policy from disk, so it brings its own.
const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

const POLICY = readFileSync(
  fileURLToPath(new URL('../../../../src-tauri/src/security/policy.rs', import.meta.url)),
  'utf8',
);

function rustList(name: string): string[] {
  const block = POLICY.split(`const ${name}: &[&str] = &[`)[1]?.split('];')[0] ?? '';
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

const allowedHosts = rustList('ALLOWED_HOSTS');
const allowedProviders = rustList('ALLOWED_LLM_PROVIDERS');
const cloudProviders = PROVIDER_DEFS.filter((def) => def.kind === 'cloud').map((def) => def.provider);

// Providers whose address is not a plain OpenAI-compatible one.
const OWN_SHAPE: LlmProviderId[] = ['gemini', 'anthropic'];
// Built from a template at call time, because the account id is in the path.
const DYNAMIC: LlmProviderId[] = ['cloudflare'];

describe('provider catalogue', () => {
  it('gives every cloud provider somewhere to store a key', () => {
    const missing = PROVIDER_DEFS.filter((def) => def.kind === 'cloud' && !def.keyName);
    expect(missing).toEqual([]);
  });

  it('gives every cloud provider a chat address and a model list', () => {
    const noChat = cloudProviders.filter(
      (p) => !OWN_SHAPE.includes(p) && !DYNAMIC.includes(p) && !OPENAI_COMPAT_CHAT_URL[p],
    );
    const noModels = cloudProviders.filter(
      (p) => !OWN_SHAPE.includes(p) && !DYNAMIC.includes(p) && !OPENAI_COMPAT_MODELS_URL[p],
    );
    expect({ noChat, noModels }).toEqual({ noChat: [], noModels: [] });
  });

  it('only ever talks to https addresses', () => {
    const addresses = [...Object.values(OPENAI_COMPAT_CHAT_URL), ...Object.values(OPENAI_COMPAT_MODELS_URL)];
    expect(addresses.filter((url) => !url.startsWith('https://'))).toEqual([]);
  });
});

describe('the Rust guard knows the same providers', () => {
  it('allows every provider the app offers, and no others', () => {
    expect([...allowedProviders].sort()).toEqual([...PROVIDER_DEFS.map((d) => d.provider)].sort());
  });

  it('allows the host of every provider address', () => {
    const hosts = [...Object.values(OPENAI_COMPAT_CHAT_URL), ...Object.values(OPENAI_COMPAT_MODELS_URL)].map(
      (url) => new URL(url).host,
    );
    expect([...new Set(hosts)].filter((host) => !allowedHosts.includes(host))).toEqual([]);
  });

  it("allows Cloudflare's host, whose address is built per account", () => {
    const url = cloudflareEndpoint('chat', '0123456789abcdef0123456789abcdef');
    expect(new URL(url!).host).toBe('api.cloudflare.com');
    expect(allowedHosts).toContain('api.cloudflare.com');
  });
});

describe('the Cloudflare account id', () => {
  it('is only accepted as thirty-two hex characters', () => {
    expect(normalizeCloudflareAccount(' 0123456789ABCDEF0123456789abcdef ')).toBe(
      '0123456789abcdef0123456789abcdef',
    );
    expect(normalizeCloudflareAccount('0123456789abcdef')).toBe('');
    expect(normalizeCloudflareAccount('../../etc/passwd')).toBe('');
    expect(normalizeCloudflareAccount('0123456789abcdef0123456789abcde/')).toBe('');
  });

  it('cannot add a host, a path or a query to the address', () => {
    expect(cloudflareEndpoint('chat', 'evil.example.com/')).toBeUndefined();
    expect(cloudflareEndpoint('chat', '../../../v4/accounts/x')).toBeUndefined();
    expect(cloudflareEndpoint('chat', '0123456789abcdef0123456789abcdef?x=1')).toBeUndefined();
    expect(cloudflareEndpoint('chat', '0123456789abcdef0123456789abcdef')).toBe(
      'https://api.cloudflare.com/client/v4/accounts/0123456789abcdef0123456789abcdef/ai/v1/chat/completions',
    );
  });

  it('leaves Cloudflare without an address until the account id is saved', () => {
    localStorage.clear();
    expect(chatUrlFor('cloudflare')).toBeUndefined();
    expect(modelsUrlFor('cloudflare')).toBeUndefined();

    setCloudflareAccount('0123456789abcdef0123456789abcdef');
    expect(chatUrlFor('cloudflare')).toContain('/ai/v1/chat/completions');
    expect(modelsUrlFor('cloudflare')).toContain('/ai/models/search');

    setCloudflareAccount('not an account');
    expect(chatUrlFor('cloudflare')).toBeUndefined();
  });
});

describe('Moonshot runs on two platforms', () => {
  it('starts on the first and follows the one that answered', () => {
    localStorage.clear();
    expect(chatUrlFor('moonshot')).toBe('https://api.moonshot.ai/v1/chat/completions');

    setMoonshotHost('https://api.moonshot.cn');
    expect(chatUrlFor('moonshot')).toBe('https://api.moonshot.cn/v1/chat/completions');
    expect(modelsUrlFor('moonshot')).toBe('https://api.moonshot.cn/v1/models');
  });

  it('ignores a host that is not one of the two', () => {
    localStorage.clear();
    setMoonshotHost('https://evil.example.com');
    expect(chatUrlFor('moonshot')).toBe('https://api.moonshot.ai/v1/chat/completions');
  });

  it('has both platforms on the guard list', () => {
    for (const host of MOONSHOT_HOSTS) {
      expect(allowedHosts).toContain(new URL(host).host);
    }
  });
});
