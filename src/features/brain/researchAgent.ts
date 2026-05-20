// Agentic biomedical research. The model is handed the guarded medical-source
// tools and drives the search itself: it chooses queries, reads the records
// that come back, refines, and then writes an answer that cites only records
// it actually retrieved.
//
// Tool-search rounds use the non-streaming completion path because every
// provider adapter handles tool calls there; the final answer is streamed.

import { completeWithModelChain, streamWithModelChain } from '@core/llm/ProviderRegistry';
import { tools as toolRegistry } from '@core/tools/ToolRegistry';
import type { LlmMessage, LlmToolSpec } from '@core/llm/types';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';

const MAX_SEARCH_ROUNDS = 4;
const SNIPPET_CHARS = 320;

const RESEARCH_TOOL_NAMES = [
  'rag_search',
  'pubmed_search',
  'europepmc_fetch',
  'openalex_query',
  'ctgov_search',
  'openfda_query',
  'rxnorm_lookup',
];

// The anti-hallucination contract: the agent may only state facts it pulled
// from a tool result in this conversation, and must say so when evidence is
// thin rather than filling the gap from training data.
const SYSTEM_PROMPT = `You are HashCerebrum Research, a biomedical research agent. You answer only from sources you retrieve with tools in this conversation — never from training memory.

Tools:
- rag_search — this project's saved memory of earlier research (evidence and answers from past runs in the same project)
- pubmed_search, europepmc_fetch — peer-reviewed literature
- openalex_query — scholarly works and metadata
- ctgov_search — registered clinical trials
- openfda_query — drug and device safety records
- rxnorm_lookup — drug name normalization
Every database tool queries a trusted source through an audited backend.

Workflow:
1. Call rag_search first to see what this project has already researched. Use it to focus your searches and to avoid repeating work already done.
2. Break the question into focused search queries and call the relevant database tools. You may call several tools in one step.
3. Read the returned records. Each database record is tagged with an [S#] marker. If results are thin or off-target, refine the query and search again.
4. Once you have enough evidence, stop calling tools.

Hard rules:
- Never state a biomedical fact, statistic, study finding, drug effect, dose, or citation that did not come from a tool result in this conversation.
- Cite every factual claim with the [S#] marker of the database record it came from.
- Never invent a PMID, DOI, author, year, or title.
- rag_search results are this project's prior research, not freshly retrieved records — they carry no [S#] marker. Use them to avoid redundant searching; when you cite a specific fact, cite the [S#] database record from this run. You may rely on project memory when no fresh search is possible, but say plainly that the answer draws on earlier project research.
- If the tools return little or nothing, say so plainly. "The searched databases returned no strong evidence for X" is a correct and acceptable answer — do not fill the gap with guesses.
- This is research triage, not medical advice.`;

export interface ResearchAgentCallbacks {
  onToolCall: (toolName: string) => void;
  onToolResult: (toolName: string, count: number) => void;
  onToolError: (toolName: string, message: string) => void;
  onPhase: (phase: 'searching' | 'answering') => void;
  onAnswerToken: (delta: string) => void;
}

export interface ResearchAgentResult {
  answer: string;
  evidence: EvidenceItem[];
  modelUsed: string;
  toolCalls: number;
}

function toolSpecs(): LlmToolSpec[] {
  return RESEARCH_TOOL_NAMES.map((name) => toolRegistry.get(name))
    .filter((tool): tool is NonNullable<typeof tool> => !!tool)
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function asRecords(result: unknown): EvidenceItem[] {
  const records = (result as MedicalSourceResult | undefined)?.results;
  return Array.isArray(records) ? records : [];
}

// Render tool results with stable [S#] markers so the model has something
// concrete to cite and the UI citation list lines up with the markers.
function formatRecords(toolName: string, records: EvidenceItem[], startIndex: number): string {
  if (records.length === 0) return `${toolName}: no records returned.`;
  const lines = records.map((record, offset) => {
    const marker = `S${startIndex + offset + 1}`;
    const year = record.year ? ` (${record.year})` : '';
    const id = record.identifiers?.pmid
      ? ` PMID:${record.identifiers.pmid}`
      : record.identifiers?.doi
        ? ` DOI:${record.identifiers.doi}`
        : '';
    const snippet = record.snippet
      ? ` — ${record.snippet.replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS)}`
      : '';
    return `[${marker}] ${record.source.toUpperCase()}${year} ${record.title}.${id}${snippet}`;
  });
  return `${toolName} returned ${records.length} record(s):\n${lines.join('\n')}`;
}

export async function runResearchAgent(
  query: string,
  model: string,
  callbacks: ResearchAgentCallbacks,
): Promise<ResearchAgentResult> {
  const specs = toolSpecs();
  const messages: LlmMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Research question: ${query}` },
  ];
  const evidence: EvidenceItem[] = [];
  let toolCalls = 0;
  let memoryHits = 0;

  callbacks.onPhase('searching');

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round += 1) {
    const resp = await completeWithModelChain(model, {
      messages,
      tools: specs,
      temperature: 0.2,
      maxTokens: 1200,
    });
    if (resp.toolCalls.length === 0) break;

    messages.push({ role: 'assistant', content: resp.content });

    for (const call of resp.toolCalls) {
      callbacks.onToolCall(call.name);
      const tool = toolRegistry.get(call.name);
      if (!tool) {
        callbacks.onToolError(call.name, 'unknown tool');
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: `${call.name}: error — unknown tool.`,
        });
        continue;
      }
      try {
        const result = await tool.execute(call.args);
        toolCalls += 1;
        if (call.name === 'rag_search') {
          // Project-memory results are background context — they are not
          // merged into the citable evidence set.
          const memory = (result ?? {}) as { count?: unknown; text?: unknown };
          const count = typeof memory.count === 'number' ? memory.count : 0;
          memoryHits += count;
          callbacks.onToolResult(call.name, count);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: typeof memory.text === 'string' ? memory.text : 'Project memory: no result.',
          });
        } else {
          const records = asRecords(result);
          const startIndex = evidence.length;
          evidence.push(...records);
          callbacks.onToolResult(call.name, records.length);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: formatRecords(call.name, records, startIndex),
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        callbacks.onToolError(call.name, detail);
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          content: `${call.name}: error — ${detail}`,
        });
      }
    }
  }

  // Final answer — streamed, no tools. A fresh instruction stops the model
  // issuing more tool calls and focuses it on writing from what it found.
  callbacks.onPhase('answering');
  let finalInstruction: string;
  if (evidence.length > 0) {
    finalInstruction =
      'Write the final research answer now. Use only the retrieved records above and cite every claim with its [S#] marker.';
  } else if (memoryHits > 0) {
    finalInstruction =
      "No new database records were retrieved this run, but this project's saved memory above is relevant. Answer from the project memory and state plainly that the answer draws on earlier project research rather than a fresh database search.";
  } else {
    finalInstruction =
      'No records were retrieved. State plainly that the searched databases returned no strong evidence for this question. Do not answer from training memory.';
  }
  messages.push({ role: 'user', content: finalInstruction });
  const final = await streamWithModelChain(
    model,
    { messages, temperature: 0.2, maxTokens: 1500 },
    { onToken: callbacks.onAnswerToken },
  );

  return { answer: final.content, evidence, modelUsed: final.modelUsed, toolCalls };
}
