import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { tools } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import { runResearchAgent } from '../researchAgent';

vi.mock('@core/llm/ProviderRegistry', () => ({
  completeWithModelChain: vi.fn(async () => {
    throw new Error('planner unavailable');
  }),
  streamWithModelChain: vi.fn(async () => {
    throw new Error('synthesizer unavailable');
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

describe('runResearchAgent', () => {
  it('still fetches source evidence when model tool planning and synthesis fail', async () => {
    const callbacks = {
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onToolError: vi.fn(),
      onPhase: vi.fn(),
      onAnswerToken: vi.fn(),
    };

    const result = await runResearchAgent('glioma biomarker trial safety', 'openrouter:test-model', callbacks);

    expect(executedTools).toEqual(Object.keys(SOURCE_BY_TOOL));
    expect(result.evidence).toHaveLength(Object.keys(SOURCE_BY_TOOL).length);
    expect(result.answer).toContain('Source agents retrieved');
    expect(result.answer).toContain('planner unavailable');
    expect(callbacks.onToolResult).toHaveBeenCalledWith('pubmed_search', 1);
    expect(callbacks.onToolError).not.toHaveBeenCalled();
  });
});
