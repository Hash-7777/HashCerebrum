// A topic specialist — a guarded tool-loop scoped to one medical domain.
// Each specialist runs with its own model and only its allowed tools,
// retrieves real records, and writes a findings summary for the boss.
// Generalises the former single-model researchAgent into one swarm worker.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';
import { tools as toolRegistry } from '@core/tools/ToolRegistry';
import type { AgentDef } from '@config/agents';
import type { LlmMessage, LlmToolSpec } from '@core/llm/types';
import type { EvidenceItem, MedicalSourceResult } from '@platform/index';
import type { SpecialistResult, SwarmCallbacks } from './types';

const MAX_ROUNDS = 3;
const SNIPPET_CHARS = 280;

function toolSpecs(toolNames: string[]): LlmToolSpec[] {
  return toolNames
    .map((name) => toolRegistry.get(name))
    .filter((tool): tool is NonNullable<typeof tool> => !!tool)
    .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function asRecords(result: unknown): EvidenceItem[] {
  const records = (result as MedicalSourceResult | undefined)?.results;
  return Array.isArray(records) ? records : [];
}

// Render tool results with stable [S#] markers so the model has concrete
// records to reason from.
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

function systemPrompt(agent: AgentDef): string {
  return `You are the ${agent.label} research specialist on the HashCerebrum biomedical team. ${agent.specialty}

You report only from records you retrieve with tools in this conversation — never from training memory.

Workflow:
1. Call rag_search first to reuse what this project already found.
2. Search the medical databases for your angle of the question. If results are thin or off-target, refine and search again.
3. Stop calling tools once you have enough, then write a concise findings summary.

Hard rules:
- State only facts that came from a tool result in this conversation. Never invent a PMID, DOI, author, year, title, or statistic.
- Each retrieved record is tagged [S#]; refer to records by their source and title.
- If the databases return little or nothing, say so plainly — do not fill the gap from memory.
- Stay within your specialty (${agent.topicHint}); ignore parts of the question outside it.`;
}

export async function runSpecialist(
  agent: AgentDef,
  model: string,
  subQuery: string,
  callbacks: SwarmCallbacks,
): Promise<SpecialistResult> {
  const specs = toolSpecs(agent.tools);
  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt(agent) },
    { role: 'user', content: `Research task: ${subQuery}` },
  ];
  const evidence: EvidenceItem[] = [];
  let toolCalls = 0;

  callbacks.onSpecialistStart(agent.id, subQuery);

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const resp = await completeWithModelChain(model, {
        messages,
        tools: specs,
        temperature: 0.2,
        maxTokens: 1100,
      });
      if (resp.toolCalls.length === 0) break;
      messages.push({ role: 'assistant', content: resp.content });

      for (const call of resp.toolCalls) {
        callbacks.onToolCall(agent.id, call.name);
        const tool = toolRegistry.get(call.name);
        if (!tool) {
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
            // Project memory is background context, not citable evidence.
            const memory = (result ?? {}) as { count?: unknown; text?: unknown };
            const count = typeof memory.count === 'number' ? memory.count : 0;
            callbacks.onToolResult(agent.id, call.name, count);
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
            callbacks.onToolResult(agent.id, call.name, records.length);
            messages.push({
              role: 'tool',
              toolCallId: call.id,
              toolName: call.name,
              content: formatRecords(call.name, records, startIndex),
            });
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            toolName: call.name,
            content: `${call.name}: error — ${detail}`,
          });
        }
      }
    }

    // Findings summary — non-streamed, since specialists run in parallel.
    messages.push({
      role: 'user',
      content:
        evidence.length > 0
          ? 'Write a concise findings summary for your specialty using only the retrieved records above. State what the evidence shows and note any gaps.'
          : 'No records were retrieved. State plainly that the databases returned no strong evidence for your part of the question. Do not answer from memory.',
    });
    const final = await completeWithModelChain(model, { messages, temperature: 0.2, maxTokens: 900 });

    callbacks.onSpecialistDone(agent.id, evidence.length);
    return { agentId: agent.id, label: agent.label, subQuery, findings: final.content, evidence, toolCalls };
  } catch (error) {
    // A specialist failure is contained — the swarm continues with the rest.
    const detail = error instanceof Error ? error.message : String(error);
    callbacks.onSpecialistError(agent.id, detail);
    return { agentId: agent.id, label: agent.label, subQuery, findings: '', evidence, toolCalls, error: detail };
  }
}
