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
      // blob: is allowed so pdf.js can read the in-memory exported PDF for the
      // preview; it is local-only and cannot reach the network, so no external
      // host is permitted (asserted below).
      expect(policy).toContain("connect-src 'self' blob: ipc: http://ipc.localhost");
      expect(policy).not.toMatch(/api\.openai|generativelanguage|anthropic|openrouter|localhost:11434/);
    }
  });

  it('keeps production LLM code on the platform proxy instead of direct fetch', () => {
    // The registry picks the model chain; the per-provider requests it makes
    // live in providerTransports.ts. Neither may reach the network directly.
    const providerRegistry = readRepoFile('src/core/llm/ProviderRegistry.ts');
    const providerTransports = readRepoFile('src/core/llm/providerTransports.ts');
    const modelDiscovery = readRepoFile('src/core/llm/modelDiscovery.ts');

    expect(providerRegistry).not.toContain('fetch(');
    expect(providerTransports).not.toContain('fetch(');
    expect(modelDiscovery).not.toContain('fetch(');
    expect(providerTransports).toContain('platform().llm.httpPost');
    expect(modelDiscovery).toContain('platform().llm.httpGet');
  });
});
