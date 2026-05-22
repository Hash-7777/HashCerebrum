import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('release security configuration', () => {
  it('keeps the Tauri renderer CSP locked to the app and IPC origins', () => {
    const config = readRepoFile('src-tauri/tauri.conf.json');
    const csp = config.match(/"csp":\s*"([^"]+)"/)?.[1] ?? '';
    const devCsp = config.match(/"devCsp":\s*"([^"]+)"/)?.[1] ?? '';

    for (const policy of [csp, devCsp]) {
      expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'");
      expect(policy).not.toContain("'unsafe-eval'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("frame-src 'self' blob:");
      expect(policy).toContain("connect-src 'self' ipc: http://ipc.localhost");
      expect(policy).not.toMatch(/api\.openai|generativelanguage|anthropic|openrouter|localhost:11434/);
    }
  });

  it('keeps production LLM code on the platform proxy instead of direct fetch', () => {
    const providerRegistry = readRepoFile('src/core/llm/ProviderRegistry.ts');
    const modelDiscovery = readRepoFile('src/core/llm/modelDiscovery.ts');

    expect(providerRegistry).not.toContain('fetch(');
    expect(modelDiscovery).not.toContain('fetch(');
    expect(providerRegistry).toContain('platform().llm.httpPost');
    expect(modelDiscovery).toContain('platform().llm.httpGet');
  });
});
