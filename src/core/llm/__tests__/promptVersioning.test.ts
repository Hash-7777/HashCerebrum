import { describe, expect, it } from 'vitest';
import { registerPrompt, getPromptVersion, allPromptVersions, hashConcretePrompt } from '../promptVersioning';

describe('promptVersioning', () => {
  it('returns consistent hash for identical templates', async () => {
    const hash1 = await registerPrompt('You are a helpful assistant.', 'system');
    const hash2 = await registerPrompt('You are a helpful assistant.', 'system');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('stores template in registry', async () => {
    const hash = await registerPrompt('Summarise the evidence.', 'user');
    const entry = getPromptVersion(hash);
    expect(entry).toBeDefined();
    expect(entry!.template).toBe('Summarise the evidence.');
    expect(entry!.role).toBe('user');
    expect(entry!.registeredAt).toMatch(/^\d{4}-/);
  });

  it('returns different hashes for different templates', async () => {
    const h1 = await registerPrompt('Template A', 'system');
    const h2 = await registerPrompt('Template B', 'system');
    expect(h1).not.toBe(h2);
  });

  it('hashes concrete prompts deterministically', async () => {
    const h1 = await hashConcretePrompt('Concrete prompt text');
    const h2 = await hashConcretePrompt('Concrete prompt text');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('lists all registered versions', async () => {
    const before = allPromptVersions().length;
    await registerPrompt('New template for listing', 'system');
    const after = allPromptVersions().length;
    expect(after).toBe(before + 1);
  });
});
