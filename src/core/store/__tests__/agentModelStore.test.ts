import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, parseModelRef, type ModelGroup, type ModelOption } from '@core/llm/modelCatalog';
import { agentModelFor, autoAssignModels, isConnectedModelValue, useAgentModelStore } from '../agentModelStore';
import { initialModelStatuses } from '@core/llm/modelDiscovery';
import { useModelCatalogStore } from '../modelCatalogStore';
import { AGENTS } from '@config/agents';

function model(value: string, label = value): ModelOption {
  return { value, label, shortLabel: label };
}

const groups: ModelGroup[] = [
  {
    provider: 'groq',
    label: 'Groq',
    keyName: 'llm.groq',
    models: [model('cloud:groq:llama-3.1-8b', 'Llama 3.1 8B')],
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    keyName: 'llm.openai',
    models: [model('cloud:openai:gpt-5', 'GPT-5')],
  },
];

beforeEach(() => {
  useAgentModelStore.setState({ overrides: {}, hydrated: true });
  useModelCatalogStore.setState({
    groups,
    statuses: initialModelStatuses(),
    hydrated: true,
    refreshing: false,
    lastFetchedAt: null,
  });
});

describe('autoAssignModels — provider spreading', () => {
  it('spreads specialists across distinct providers when several are connected', () => {
    const assigned = autoAssignModels([
      model('cloud:groq:openai/gpt-oss-120b', 'GPT OSS 120B'),
      model('cloud:gemini:gemini-2.5-pro', 'Gemini 2.5 Pro'),
      model('cloud:cerebras:llama-3.3-70b', 'Llama 3.3 70B'),
      model('cloud:samba:llama-3.1-8b', 'Llama 3.1 8B'),
    ]);
    const specialistProviders = AGENTS.filter((a) => a.kind !== 'boss').map(
      (a) => parseModelRef(assigned[a.id]!).provider,
    );
    // Several providers connected → specialists must not all land on one key.
    expect(new Set(specialistProviders).size).toBeGreaterThanOrEqual(3);
  });

  it('falls back to a single provider for every agent when only one is connected', () => {
    const assigned = autoAssignModels([
      model('cloud:groq:openai/gpt-oss-120b', 'GPT OSS 120B'),
      model('cloud:groq:llama-3.1-8b', 'Llama 3.1 8B'),
    ]);
    for (const agent of AGENTS) {
      expect(parseModelRef(assigned[agent.id]!).provider).toBe('groq');
    }
  });

  it('gives every agent the default model when nothing is connected', () => {
    const assigned = autoAssignModels([]);
    for (const agent of AGENTS) expect(assigned[agent.id]).toBe(DEFAULT_MODEL);
  });

  it('keeps the throttled free 405B that cannot tool-call out of the boss slot', () => {
    // The exact reported bug: a free 405B used to win the boss slot on raw
    // parameter count, then 429'd and could not tool-call. OpenRouter reports it
    // without `tools`, so discovery marks supportsTools:false and it is excluded.
    const assigned = autoAssignModels([
      {
        value: 'cloud:openrouter:nousresearch/hermes-3-llama-3.1-405b:free',
        label: 'Hermes 3 405B (free)',
        shortLabel: 'Hermes',
        supportsTools: false,
      },
      model('cloud:groq:openai/gpt-oss-120b', 'GPT OSS 120B'),
    ]);
    expect(assigned.boss).toBe('cloud:groq:openai/gpt-oss-120b');
    for (const agent of AGENTS) expect(assigned[agent.id]).not.toContain('hermes');
  });

  it('prefers the paid variant over the throttled free variant of a comparable model', () => {
    const assigned = autoAssignModels([
      model('cloud:openrouter:deepseek/deepseek-v3:free', 'DeepSeek V3 (free)'),
      model('cloud:openrouter:deepseek/deepseek-v3', 'DeepSeek V3'),
    ]);
    expect(assigned.boss).toBe('cloud:openrouter:deepseek/deepseek-v3');
  });
});

describe('agentModelFor', () => {
  it('uses a connected manual override', () => {
    useAgentModelStore.setState({ overrides: { boss: 'cloud:groq:llama-3.1-8b' } });

    expect(agentModelFor('boss')).toBe('cloud:groq:llama-3.1-8b');
  });

  it('ignores a stale manual override and falls back to connected auto assignment', () => {
    useAgentModelStore.setState({ overrides: { boss: 'cloud:openrouter:removed-model' } });

    expect(isConnectedModelValue('cloud:openrouter:removed-model')).toBe(false);
    expect(agentModelFor('boss')).toBe('cloud:openai:gpt-5');
  });

  it('falls back to the default local model when no connected models exist', () => {
    useModelCatalogStore.setState({ groups: [] });
    useAgentModelStore.setState({ overrides: { boss: 'cloud:openrouter:removed-model' } });

    expect(agentModelFor('boss')).toBe(DEFAULT_MODEL);
  });

  it('assigns the boss the larger model when same-family models would tie on coarse tier', () => {
    useModelCatalogStore.setState({
      groups: [
        {
          provider: 'groq',
          label: 'Groq',
          keyName: 'llm.groq',
          models: [
            model('cloud:groq:llama-4-scout-17b', 'Llama 4 Scout 17B'),
            model('cloud:groq:llama-3.3-70b-versatile', 'Llama 3.3 70B'),
          ],
        },
      ],
    });

    expect(agentModelFor('boss')).toBe('cloud:groq:llama-3.3-70b-versatile');
  });
});
