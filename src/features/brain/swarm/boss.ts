// The boss agent — the single agent the user talks to. It routes each
// message (plain chat vs. research), decomposes a research question into
// specialist sub-tasks, and synthesizes their findings into one cited
// answer.

import { completeWithModelChain, streamWithModelChain } from '@core/llm/ProviderRegistry';
import { SPECIALIST_AGENTS, type AgentId } from '@config/agents';
import type { LlmMessage } from '@core/llm/types';
import type { EvidenceItem } from '@platform/index';
import { paperSystemInstruction, type PaperRequest } from './paper';
import type { SpecialistResult, SpecialistTask } from './types';

const SNIPPET_CHARS = 240;
const MAX_TASKS = 4;

export interface BossPlan {
  mode: 'chat' | 'research';
  tasks: SpecialistTask[];
}

const SPECIALIST_IDS = new Set<AgentId>(SPECIALIST_AGENTS.map((agent) => agent.id));

function rosterText(): string {
  return SPECIALIST_AGENTS.map((agent) => `- ${agent.id}: ${agent.specialty} (covers ${agent.topicHint})`).join(
    '\n',
  );
}

function parsePlan(text: string): BossPlan | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const obj = JSON.parse(match[0]) as { mode?: unknown; tasks?: unknown };
    if (obj.mode === 'chat') return { mode: 'chat', tasks: [] };
    if (obj.mode === 'research' && Array.isArray(obj.tasks)) {
      const tasks: SpecialistTask[] = [];
      for (const raw of obj.tasks) {
        const agent = (raw as { agent?: unknown })?.agent;
        const subQuery = (raw as { subQuery?: unknown })?.subQuery;
        if (
          typeof agent === 'string' &&
          SPECIALIST_IDS.has(agent as AgentId) &&
          typeof subQuery === 'string' &&
          subQuery.trim()
        ) {
          tasks.push({ agentId: agent as AgentId, subQuery: subQuery.trim() });
        }
      }
      if (tasks.length > 0) return { mode: 'research', tasks: tasks.slice(0, MAX_TASKS) };
    }
  } catch {
    /* malformed JSON — fall through */
  }
  return null;
}

// Decide chat vs. research and, for research, which specialists handle what.
export async function planResearch(
  model: string,
  question: string,
  conversation: LlmMessage[],
): Promise<BossPlan> {
  const planPrompt = `You are the Boss of HashCerebrum, a biomedical research team. Decide how to handle the user's latest message.

Specialists you can delegate to:
${rosterText()}

- If the message is small talk, a greeting, a thank-you, or a non-biomedical request, set "mode" to "chat".
- If it asks for biomedical facts, evidence, drugs, conditions, trials, or anything that needs sources, set "mode" to "research": break it into focused sub-questions and assign each to the most relevant specialist. Use only the specialists that fit (1 to ${MAX_TASKS} tasks).
- If it asks for a full research paper, manuscript, journal article, publication-style article, or publishable draft, always set "mode" to "research" and delegate enough specialist tasks to support a manuscript.

Reply with ONLY a JSON object and nothing else:
{"mode":"chat"}
or
{"mode":"research","tasks":[{"agent":"<specialist id>","subQuery":"<focused question>"}]}`;

  const messages: LlmMessage[] = [
    { role: 'system', content: 'You reply with a single JSON object and nothing else.' },
    ...conversation,
    { role: 'user', content: `${planPrompt}\n\nUser message: ${question}` },
  ];

  try {
    const resp = await completeWithModelChain(model, { messages, temperature: 0.1, maxTokens: 600 });
    const parsed = parsePlan(resp.content);
    if (parsed) return parsed;
  } catch {
    /* fall through to a safe default */
  }
  // Safe default: research the question through the literature specialist.
  return { mode: 'research', tasks: [{ agentId: 'literature', subQuery: question }] };
}

// Plain-chat answer — streamed.
export async function bossChat(
  model: string,
  question: string,
  conversation: LlmMessage[],
  onToken: (delta: string) => void,
): Promise<{ content: string; modelUsed: string }> {
  const messages: LlmMessage[] = [
    {
      role: 'system',
      content:
        'You are HashCerebrum, a concise biomedical research assistant. Chat naturally. If the user asks for biomedical facts that need sources, answer briefly and mention you can run a full sourced research pass. Never invent citations, studies, PMIDs, statistics, or drug data.',
    },
    ...conversation,
    { role: 'user', content: question },
  ];
  const res = await streamWithModelChain(model, { messages, temperature: 0.5, maxTokens: 1100 }, { onToken });
  return { content: res.content, modelUsed: res.modelUsed };
}

function formatEvidenceLine(record: EvidenceItem, index: number): string {
  const year = record.year ? ` (${record.year})` : '';
  const id = record.identifiers?.pmid
    ? ` PMID:${record.identifiers.pmid}`
    : record.identifiers?.doi
      ? ` DOI:${record.identifiers.doi}`
      : '';
  const snippet = record.snippet
    ? ` — ${record.snippet.replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS)}`
    : '';
  return `[S${index + 1}] ${record.source.toUpperCase()}${year} ${record.title}.${id}${snippet}`;
}

// Synthesize the specialists' findings into the final answer — streamed.
export async function synthesize(
  model: string,
  question: string,
  specialists: SpecialistResult[],
  mergedEvidence: EvidenceItem[],
  onToken: (delta: string) => void,
  paperRequest?: PaperRequest | null,
): Promise<{ content: string; modelUsed: string }> {
  const evidenceBlock =
    mergedEvidence.length > 0
      ? mergedEvidence.map((record, index) => formatEvidenceLine(record, index)).join('\n')
      : '(no records were retrieved)';
  const specialistBlock = specialists
    .map((specialist) => {
      const body = specialist.error
        ? `Error: ${specialist.error}`
        : specialist.findings.trim() || '(no findings)';
      return `### ${specialist.label}${specialist.error ? ' (failed)' : ''}\nTask: ${specialist.subQuery}\n${body}`;
    })
    .join('\n\n');

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: paperRequest
        ? paperSystemInstruction(paperRequest)
        : `You are the Boss of HashCerebrum. Your specialists have researched the question and retrieved records. Write the final answer for the user.

Hard rules:
- Use only the retrieved records and specialist findings below. Never add a fact, statistic, drug effect, dose, or citation that is not supported there.
- Cite every factual claim with the [S#] marker of the record it came from.
- Never invent a PMID, DOI, author, year, or title.
- If the evidence is thin or the specialists found little, say so plainly.
- This is research triage, not medical advice.`,
    },
    {
      role: 'user',
      content: paperRequest ? `Manuscript request: ${question}

Retrieved records:
${evidenceBlock}

Specialist findings:
${specialistBlock}

Write the full manuscript draft now. Use the required sections exactly. Cite factual claims with [S#] markers and include a References section mapped to the retrieved records.`
        : `Question: ${question}

Retrieved records:
${evidenceBlock}

Specialist findings:
${specialistBlock}

Write the final, well-structured research answer now, citing [S#] markers for every claim.`,
    },
  ];
  const res = await streamWithModelChain(
    model,
    { messages, temperature: paperRequest ? 0.18 : 0.25, maxTokens: paperRequest ? 3800 : 1600 },
    { onToken },
  );
  return { content: res.content, modelUsed: res.modelUsed };
}
