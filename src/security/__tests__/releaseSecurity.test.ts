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

    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("frame-src 'self' blob:");
    expect(csp).toContain("connect-src 'self' ipc: http://ipc.localhost");
    expect(csp).not.toMatch(/api\.openai|generativelanguage|anthropic|openrouter|localhost:11434/);
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
