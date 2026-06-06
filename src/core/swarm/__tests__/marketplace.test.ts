import { describe, expect, it } from 'vitest';
import { validateManifest, registerManifest, listAgents, getAgent, loadRegistryFromDirectory } from '../marketplace';

describe('marketplace', () => {
  it('validates a correct manifest', () => {
    const r = validateManifest({
      version: 'hc.agent.v1',
      id: 'test',
      name: 'Test Agent',
      systemPrompt: 'You are a test.',
      tools: [],
      compliance: { humanInTheLoop: true, evidenceRequired: true, maxTokens: 1000 },
    });
    expect(r.valid).toBe(true);
  });

  it('rejects invalid manifest', () => {
    const r = validateManifest({ version: 'wrong', id: 123 });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('registers and lists agents', () => {
    registerManifest({
      version: 'hc.agent.v1',
      id: 'demo',
      name: 'Demo',
      description: 'A demo agent',
      capabilities: [],
      tools: [],
      systemPrompt: 'Demo.',
      compliance: { humanInTheLoop: false, evidenceRequired: false, maxTokens: 500 },
      schema: {},
    });
    expect(listAgents().some((a) => a.id === 'demo')).toBe(true);
    expect(getAgent('demo')?.name).toBe('Demo');
  });

  it('loads built-in registry', async () => {
    const count = await loadRegistryFromDirectory();
    expect(count).toBeGreaterThan(0);
  });
});
