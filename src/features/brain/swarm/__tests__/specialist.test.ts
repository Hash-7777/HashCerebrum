import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentById } from '@config/agents';
import { tools } from '@core/tools/ToolRegistry';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import { runSwarm } from '../runSwarm';
import { runSpecialist } from '../specialist';

const llmMocks = vi.hoisted(() => ({
  completeWithModelChain: vi.fn(),
  streamWithModelChain: vi.fn(),
}));

vi.mock('@core/llm/ProviderRegistry', () => ({
  completeWithModelChain: llmMocks.completeWithModelChain,
  streamWithModelChain: llmMocks.streamWithModelChain,
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
  llmMocks.completeWithModelChain.mockReset();
  llmMocks.streamWithModelChain.mockReset();
});

function callbacks() {
  return {
    onBossPhase: vi.fn(),
    onSpecialistStart: vi.fn(),
    onSpecialistDone: vi.fn(),
    onSpecialistError: vi.fn(),
    onToolCall: vi.fn(),
    onToolResult: vi.fn(),
    onAnswerToken: vi.fn(),
    onManuscriptSection: vi.fn(),
  };
}

describe('runSpecialist', () => {
  it('directly fetches source evidence when model tool planning fails', async () => {
    llmMocks.completeWithModelChain.mockRejectedValue(new Error('planner unavailable'));
    const cb = callbacks();

    const result = await runSpecialist(
      agentById('literature'),
      'openrouter:test-model',
      'glioma biomarker trial safety',
      cb,
    );

    expect(executedTools).toEqual(Object.keys(SOURCE_BY_TOOL));
    expect(result.evidence).toHaveLength(Object.keys(SOURCE_BY_TOOL).length);
    expect(result.error).toContain('planner unavailable');
    expect(cb.onToolResult).toHaveBeenCalledWith('literature', 'pubmed_search', 1);
  });
});

describe('runSwarm', () => {
  it('returns source evidence when boss planning and synthesis are unavailable', async () => {
    llmMocks.completeWithModelChain.mockRejectedValue(new Error('planner unavailable'));
    llmMocks.streamWithModelChain.mockRejectedValue(new Error('boss synthesis unavailable'));
    const cb = callbacks();

    const result = await runSwarm({
      question: 'glioma biomarker trial safety',
      conversation: [],
      modelFor: () => 'openrouter:test-model',
      callbacks: cb,
    });

    expect(result.kind).toBe('research');
    // The freeform path cites peer-reviewed literature only: drug-label sources
    // (OpenFDA, RxNorm) are dropped from the citable evidence/reference set.
    const citableSources = Object.values(SOURCE_BY_TOOL).filter((s) => s !== 'openfda' && s !== 'rxnorm');
    expect(result.evidence).toHaveLength(citableSources.length);
    expect(result.evidence.some((record) => record.source === 'openfda')).toBe(false);
    expect(result.evidence.some((record) => record.source === 'rxnorm')).toBe(false);
    expect(result.answer).toContain('Source agents retrieved');
    expect(result.answer).toContain('boss synthesis unavailable');
    expect(result.specialists[0]?.error).toContain('planner unavailable');
  });

  it('drafts a structured manuscript for a paper request even when the model is unavailable', async () => {
    llmMocks.completeWithModelChain.mockRejectedValue(new Error('planner unavailable'));
    const cb = callbacks();

    const result = await runSwarm({
      question: 'make a full research paper about NSAIDs and warfarin',
      conversation: [],
      modelFor: () => 'openrouter:test-model',
      callbacks: cb,
    });

    expect(result.kind).toBe('research');
    expect(result.specialists.map((specialist) => specialist.agentId)).toEqual([
      'literature',
      'trials',
      'data_scientist',
      'pharmacology',
      'drug_interactions',
    ]);
    expect(result.evidence.length).toBeGreaterThan(0);
    // A paper request always yields a structured manuscript — even with the
    // model unavailable, every core section is present with an honest
    // placeholder. The two evidence-gated sections (Mechanistic, Trial and
    // Registry) are omitted here because the synthetic fixtures carry no
    // mechanistic text and no trusted registry record to support them — they
    // appear only when retrieval genuinely supports them.
    expect(result.manuscript).toBeDefined();
    expect(result.manuscript?.sections.map((section) => section.heading)).toEqual([
      'Introduction',
      'Methods',
      'Evidence Base and Search Yield',
      'Clinical Evidence and Safety Outcomes',
      'Discussion',
      'Limitations',
      'Conclusion',
      'Declarations',
    ]);
    expect(result.manuscript?.sections[0]?.body.join(' ')).toContain('could not be drafted');
    expect(result.manuscript?.publication?.evidenceExtractions?.length).toBeGreaterThan(0);
    expect(result.manuscript?.publication?.claimLedger?.length).toBeGreaterThan(0);
    expect(result.manuscript?.publication?.statistics.computedAnalyses).toContain('claim_ledger');
    expect(cb.onManuscriptSection).toHaveBeenCalledWith('Searching');
    expect(cb.onManuscriptSection).toHaveBeenCalledWith('Extracting');
    expect(cb.onManuscriptSection).toHaveBeenCalledWith('Building claims');
    expect(cb.onManuscriptSection).toHaveBeenCalledWith('Drafting');
    expect(result.answer).toContain('INTRODUCTION');
  });

  it('lets the boss route ordinary messages to chat without running specialists', async () => {
    llmMocks.completeWithModelChain.mockResolvedValue({ content: '{"mode":"chat"}', toolCalls: [] });
    llmMocks.streamWithModelChain.mockImplementation(async (_model, _req, opts) => {
      opts.onToken('hello');
      return { content: 'hello', toolCalls: [], modelUsed: 'cloud:openai:gpt-5' };
    });
    const cb = callbacks();

    const result = await runSwarm({
      question: 'hi',
      conversation: [],
      modelFor: () => 'cloud:openai:gpt-5',
      callbacks: cb,
    });

    expect(result.kind).toBe('chat');
    expect(result.evidence).toHaveLength(0);
    expect(result.specialists).toHaveLength(0);
    expect(executedTools).toHaveLength(0);
    expect(cb.onBossPhase).toHaveBeenCalledWith('routing');
    expect(cb.onBossPhase).toHaveBeenCalledWith('answering');
    expect(cb.onAnswerToken).toHaveBeenCalledWith('hello');
  });

  it('uses per-agent models for routed specialist tasks', async () => {
    llmMocks.completeWithModelChain.mockImplementation(async (_model, req) => {
      const lastMessage = req.messages.at(-1)?.content ?? '';
      if (lastMessage.includes('User message:')) {
        return {
          content:
            '{"mode":"research","tasks":[{"agent":"pharmacology","subQuery":"drug safety"},{"agent":"trials","subQuery":"trial status"}]}',
          toolCalls: [],
        };
      }
      if (lastMessage.includes('Write a concise findings summary')) {
        return { content: 'specialist findings', toolCalls: [] };
      }
      return { content: '', toolCalls: [] };
    });
    llmMocks.streamWithModelChain.mockResolvedValue({
      content: 'synthesized answer [S1]',
      toolCalls: [],
      modelUsed: 'cloud:openai:gpt-5',
    });
    const requestedModels = new Map<string, string>([
      ['boss', 'cloud:openai:gpt-5'],
      ['pharmacology', 'cloud:groq:llama-3.1-8b'],
      ['trials', 'cloud:gemini:gemini-2.5-flash'],
    ]);
    const modelFor = vi.fn((agentId: string) => requestedModels.get(agentId) ?? 'cloud:openai:gpt-5');

    const result = await runSwarm({
      question: 'panadol safety and clinical trials',
      conversation: [],
      modelFor,
      callbacks: callbacks(),
    });

    expect(result.kind).toBe('research');
    expect(result.specialists.map((specialist) => specialist.agentId).sort()).toEqual(['pharmacology', 'trials']);
    expect(modelFor).toHaveBeenCalledWith('boss');
    expect(modelFor).toHaveBeenCalledWith('pharmacology');
    expect(modelFor).toHaveBeenCalledWith('trials');
  });
});
