import { describe, expect, it } from 'vitest';
import { catalogIsStale, probeTargets } from '../modelCatalogStore';
import type { ModelGroup } from '@core/llm/modelCatalog';

const group = (provider: ModelGroup['provider'], values: string[]): ModelGroup => ({
  provider,
  label: provider,
  keyName: `llm.${provider}`,
  models: values.map((value) => ({ value, label: value, shortLabel: value })),
});

const DAY = 24 * 60 * 60 * 1000;

describe('probeTargets', () => {
  const groups = [
    group('openai', ['cloud:openai:a', 'cloud:openai:b', 'cloud:openai:c', 'cloud:openai:d', 'cloud:openai:e', 'cloud:openai:f']),
    group('openrouter', ['cloud:openrouter:x/model:free', 'cloud:openrouter:y/model']),
    group('ollama', ['local:ollama:llama']),
  ];

  it("probes only each provider's strongest few models", () => {
    const targets = probeTargets(groups, {}, 10 * DAY);
    expect(targets.filter((t) => t.startsWith('cloud:openai:'))).toEqual([
      'cloud:openai:a',
      'cloud:openai:b',
      'cloud:openai:c',
      'cloud:openai:d',
    ]);
  });

  it('never probes a free-tier endpoint or a local model', () => {
    const targets = probeTargets(groups, {}, 10 * DAY);
    expect(targets).not.toContain('cloud:openrouter:x/model:free');
    expect(targets).toContain('cloud:openrouter:y/model');
    expect(targets.some((t) => t.startsWith('local:'))).toBe(false);
  });

  it('skips a model that answered within the last day, and probes it again after', () => {
    const now = 10 * DAY;
    expect(probeTargets(groups, { 'cloud:openai:a': now - DAY / 2 }, now)).not.toContain('cloud:openai:a');
    expect(probeTargets(groups, { 'cloud:openai:a': now - DAY - 1 }, now)).toContain('cloud:openai:a');
  });
});

describe('catalogIsStale', () => {
  const HOUR = 60 * 60 * 1000;
  const now = Date.parse('2026-11-04T12:00:00Z');
  it('is stale when never fetched or fetched more than half a day ago', () => {
    expect(catalogIsStale(null, false, now)).toBe(true);
    expect(catalogIsStale(new Date(now - 13 * HOUR).toISOString(), false, now)).toBe(true);
  });
  it('is fresh within half a day, and never while a refresh runs', () => {
    expect(catalogIsStale(new Date(now - 2 * HOUR).toISOString(), false, now)).toBe(false);
    expect(catalogIsStale(null, true, now)).toBe(false);
  });
});
