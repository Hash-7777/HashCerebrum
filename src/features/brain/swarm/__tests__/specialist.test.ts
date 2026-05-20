import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentById } from '@config/agents';
import { tools } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import { runSwarm } from '../runSwarm';
import { runSpecialist } from '../specialist';

vi.mock('@core/llm/ProviderRegistry', () => ({
  completeWithModelChain: vi.fn(async () => {
    throw new Error('planner unavailable');
  }),
  streamWithModelChain: vi.fn(async () => {
    throw new Error('boss synthesis unavailable');
  }),
}));

const SOURCE_BY_TOOL = {
  pubmed_search: 'pubmed',
  europepmc_fetch: 'europepmc',
  openalex_query: 'openalex',
  ctgov_search: 'ctgov',
  openfda_query: 'openfda',
  rxnorm_lookup: 'rxnorm',
} as const;

let executedTools: string[] = [];

function evidenceFor(source: EvidenceItem['source']): EvidenceItem {
  return {
    source,
    title: `${source} fallback record`,
    year: 2026,
    authors: ['HashCerebrum test'],
    identifiers: { test: source },
    snippet: `Synthetic ${source} evidence.`,
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: `test-${source}`,
  };
}

function resultFor(source: EvidenceItem['source']): MedicalSourceResult {
  return {
    source,
    results: [evidenceFor(source)],
    fetchedAt: new Date(0).toISOString(),
    provenanceHash: `result-${source}`,
  };
}

beforeAll(() => {
  for (const [name, source] of Object.entries(SOURCE_BY_TOOL)) {
    if (tools.get(name)) continue;
    tools.register({
      name,
      description: `${source} test tool`,
      parameters: {},
      execute: async () => {
        executedTools.push(name);
        return resultFor(source);
      },
    });
  }
});

beforeEach(() => {
  executedTools = [];
});

describe('runSpecialist', () => {
  it('directly fetches source evidence when model tool planning fails', async () => {
    const callbacks = {
      onBossPhase: vi.fn(),
      onSpecialistStart: vi.fn(),
      onSpecialistDone: vi.fn(),
      onSpecialistError: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAnswerToken: vi.fn(),
    };

    const result = await runSpecialist(
      agentById('literature'),
      'openrouter:test-model',
      'glioma biomarker trial safety',
      callbacks,
    );

    expect(executedTools).toEqual(Object.keys(SOURCE_BY_TOOL));
    expect(result.evidence).toHaveLength(Object.keys(SOURCE_BY_TOOL).length);
    expect(result.error).toContain('planner unavailable');
    expect(callbacks.onToolResult).toHaveBeenCalledWith('literature', 'pubmed_search', 1);
  });
});

describe('runSwarm', () => {
  it('returns source evidence when boss planning and synthesis are unavailable', async () => {
    const callbacks = {
      onBossPhase: vi.fn(),
      onSpecialistStart: vi.fn(),
      onSpecialistDone: vi.fn(),
      onSpecialistError: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onAnswerToken: vi.fn(),
    };

    const result = await runSwarm({
      question: 'glioma biomarker trial safety',
      conversation: [],
      modelFor: () => 'openrouter:test-model',
      callbacks,
    });

    expect(result.kind).toBe('research');
    expect(result.evidence).toHaveLength(Object.keys(SOURCE_BY_TOOL).length);
    expect(result.answer).toContain('Source agents retrieved');
    expect(result.answer).toContain('boss synthesis unavailable');
    expect(result.specialists[0]?.error).toContain('planner unavailable');
  });
});
