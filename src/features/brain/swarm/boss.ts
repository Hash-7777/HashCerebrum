// The boss agent — the single agent the user talks to. It routes each
// message (plain chat vs. research), decomposes a research question into
// specialist sub-tasks, and synthesizes their findings into one cited
// answer.

import {
  completeWithModelChain,
  streamWithModelChain,
  type FailoverProgress,
} from '@core/llm/ProviderRegistry';
import { SPECIALIST_AGENTS, type AgentId } from '@config/agents';
import { bus } from '@core/bus/EventBus';
import type { LlmMessage } from '@core/llm/types';
import type { EvidenceItem } from '@platform/index';
import { formatEvidenceList } from './evidenceFormat';
import { paperSystemInstruction, type PaperRequest } from './paper';
import type { SpecialistResult, SpecialistTask } from './types';

const MAX_TASKS = 4;

// Surface a silent boss-model failover in the execution trace, so a mid-run
// provider outage that the chain recovers from is visible rather than only
// changing the model label after the fact.
function emitFailover(progress: FailoverProgress): void {
  bus.emit('agent:activity', {
    agentId: 'boss',
    phase: 'tool_call',
    detail: `model unavailable — switched to ${progress.to.shortLabel} (${progress.reason.slice(0, 80)})`,
  });
}

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

// Resolve a short / back-referential follow-up ("so which is safer?", "what
// about in children?") into a self-contained biomedical query using the
// conversation, so the specialists search the actual topic instead of the
// literal pronoun-laden string. A self-contained question is returned
// unchanged; any failure falls back to the original.
const BACK_REF_FOLLOWUP_RX =
  /\b(it|its|they|them|those|these|that|this|so|also|then|which|what about|how about|same|instead|alternative|either|both|former|latter)\b/i;

export async function contextualizeQuestion(
  model: string,
  question: string,
  conversation: LlmMessage[],
): Promise<string> {
  const hasPriorContext = conversation.some((m) => m.role === 'user');
  if (!hasPriorContext) return question;
  const wordCount = question.trim().split(/\s+/).filter(Boolean).length;
  // A long, specific question with no back-reference is already standalone.
  if (wordCount > 12 && !BACK_REF_FOLLOWUP_RX.test(question)) return question;
  try {
    const res = await completeWithModelChain(model, {
      messages: [
        {
          role: 'system',
          content:
            "Rewrite the user's latest message into a SINGLE self-contained biomedical question for a literature search. Resolve every pronoun and reference using the conversation, and name the specific drugs, conditions, populations, or entities from context. Keep the user's intent. Reply with ONLY the rewritten question on one line — no preamble, no quotes.",
        },
        ...conversation.slice(-6),
        { role: 'user', content: question },
      ],
      temperature: 0.1,
      maxTokens: 120,
    });
    const rewritten = (res.content.split('\n').find((l) => l.trim()) ?? '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .trim();
    if (rewritten.length >= 8 && rewritten.length <= 300) return rewritten;
  } catch {
    /* model unavailable — fall back to the original question */
  }
  return question;
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

// Critical appraisal of a document the team already produced — used when the
// user follows up on a generated paper with "rate it", "review that draft",
// etc. Reviews ONLY the supplied text: no fresh literature retrieval, so the
// boss can never drift into rating unrelated papers it just searched for.
export async function appraisePriorWork(
  model: string,
  priorWork: string,
  question: string,
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; modelUsed: string }> {
  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are the Boss of HashCerebrum performing a critical appraisal of a document THIS TEAM ALREADY PRODUCED, shown below.

Hard rules:
- Appraise ONLY the document below — the one the user is referring to. Do NOT search for or introduce new papers, studies, PMIDs, statistics, or literature, and never rate unrelated papers.
- Do not invent facts. Judge the document on its own contents.

Cover, with specific reference to parts of the document:
- Scientific rigour and methodology.
- Whether the citations and reported numbers are internally consistent and actually support the claims (flag any citation that is not backed up, any number that appears unsupported, and any over-claiming).
- Strength and appropriateness of the evidence cited (study designs, recency, relevance).
- Structure, clarity, and balance.
- Concrete strengths and concrete weaknesses.

End with an overall rating out of 10 and a one-line verdict on publication readiness. This is an internal quality appraisal, not medical advice.`,
    },
    { role: 'user', content: `My request: ${question}\n\n--- DOCUMENT TO APPRAISE ---\n${priorWork}` },
  ];
  const res = await streamWithModelChain(model, { messages, temperature: 0.2, maxTokens: 1800 }, { onToken, signal }, emitFailover);
  return { content: res.content, modelUsed: res.modelUsed };
}

// Plain-chat answer — streamed.
export async function bossChat(
  model: string,
  question: string,
  conversation: LlmMessage[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
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
  const res = await streamWithModelChain(model, { messages, temperature: 0.5, maxTokens: 1100 }, { onToken, signal }, emitFailover);
  return { content: res.content, modelUsed: res.modelUsed };
}



// A drug-interaction report is "confident" — worth saving into the shared,
// trusted memory — unless it explicitly signals the evidence was insufficient
// or the interaction could not be determined. A clear "no clinically
// significant interaction" verdict IS confident and is kept.
const UNSURE_INTERACTION_RX =
  /\*\*\s*insufficient evidence|insufficient (evidence|data)|cannot be determined|could not (be )?establish|unable to (assess|determine)|no (records|sources|evidence) (were|was) retrieved|no relevant (records|evidence)|evidence is (too )?(thin|limited|sparse)/i;

export function isConfidentInteractionReport(text: string): boolean {
  if (!text.trim()) return false;
  return !UNSURE_INTERACTION_RX.test(text);
}

// Focused drug-interaction report — streamed. Used by the Brain "Interactions"
// toggle: a single specialist gathered interaction evidence and this writes a
// clinician-facing report from it. Strictly grounded in the retrieved records.
export async function synthesizeInteractionReport(
  model: string,
  question: string,
  specialists: SpecialistResult[],
  evidence: EvidenceItem[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; modelUsed: string }> {
  const evidenceBlock = formatEvidenceList(evidence, { markerPrefix: 'S', maxItems: 40 });
  const findings = specialists
    .map((s) => (s.error ? `Error: ${s.error}` : s.findings.trim() || '(no findings)'))
    .join('\n\n');
  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are HashCerebrum's Drug Interactions specialist writing a focused, professional drug–drug / drug–food / drug–herb interaction report for a clinician. Your job is to give a CLEAR, trusted answer, not a literature dump.

Hard rules:
- Use ONLY the retrieved records and findings provided. Never invent an interaction, mechanism, severity, dose, PMID, or statistic.
- Weight the sources by authority: regulatory drug-label interaction statements (OPENFDA records) and drug-terminology records (RXNORM) are AUTHORITATIVE for whether an interaction is recognised — treat them as the backbone of the verdict, with primary literature (PubMed/Europe PMC) adding mechanism, magnitude, and management detail.
- Cite every factual claim inline with the exact [S#] marker of the record it came from. Never write a bare or list-style marker.
- Open with a one-line VERDICT in bold, choosing exactly one: **Established interaction**, **Likely interaction**, **Theoretical / minor**, **No clinically significant interaction**, or **Insufficient evidence** — then justify it.
- Only claim "Established" or "No clinically significant interaction" when a label/regulatory record or strong literature supports it; otherwise be honest about uncertainty.
- This is research triage, not medical advice.

Write the report in this Markdown structure, each as developed prose:
**Verdict:** <one of the five above, in bold> — one sentence.

## Interaction Summary
The substances involved and whether a clinically significant interaction is supported by the evidence.
## Mechanism
The pharmacokinetic (CYP450, P-glycoprotein, protein-binding, absorption) and/or pharmacodynamic basis [S#].
## Severity & Clinical Significance
Magnitude, onset, documentation level, and which patients are at highest risk.
## Management & Monitoring
Concrete clinical actions — avoid, adjust dose, monitor (INR, drug levels, symptoms), or substitute — grounded in the sources.
## Evidence & Gaps
The type and strength of the cited sources and any gaps that limit certainty.`,
    },
    {
      role: 'user',
      content: `Interaction question: ${question}

Retrieved records:
${evidenceBlock}

Specialist findings:
${findings}

Write the drug-interaction report now, citing [S#] markers exactly as shown.`,
    },
  ];
  const res = await streamWithModelChain(
    model,
    { messages, temperature: 0.2, maxTokens: 2200 },
    { onToken, signal },
    emitFailover,
  );
  return { content: stripLeakedSpecialistLabels(res.content), modelUsed: res.modelUsed };
}

// Synthesize the specialists' findings into the final answer — streamed.
export async function synthesize(
  model: string,
  question: string,
  specialists: SpecialistResult[],
  mergedEvidence: EvidenceItem[],
  onToken: (delta: string) => void,
  paperRequest?: PaperRequest | null,
  signal?: AbortSignal,
  evidenceGap?: string,
  mini = false,
): Promise<{ content: string; modelUsed: string }> {
  // Cap the block so a deep retrieval sweep cannot overflow the synthesis
  // model's context window. mergedEvidence is already sorted best-first
  // (PubMed-favoured, recency- and identifier-weighted), so the top slice is
  // the strongest evidence; the [S#] markers stay aligned with that order.
  const evidenceBlock =
    formatEvidenceList(mergedEvidence, { markerPrefix: 'S', maxItems: 50 });
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
- Cite every factual claim with the exact [S#] marker of the record it came from (e.g. [S3]). Use the marker exactly as it appears in the retrieved records list — never invent a marker number that is not in that list.
- [S#] markers are the ONLY valid citation. Never cite a specialist's name or section label and never write tokens like "[Specialist Findings - ...]" or "[Specialist Findings]"; those are internal scaffolding, not sources. The specialist headings below are context for you, not citable references.
- Always write the marker in brackets, attached to the claim ("...bleeding risk [S2]."). Never write a marker bare or as a list label — do not enumerate the sources as "S1 - ...", "(S2, S3)", or "S1:"; those internal labels must never appear in the prose. Refer to evidence only inline as [S#].
- Never invent a PMID, DOI, author, year, or title.
- If the evidence is thin or the specialists found little, say so plainly.${evidenceGap ? `\n- ${evidenceGap}` : ''}
- This is research triage, not medical advice.`,
    },
    {
      role: 'user',
      content: paperRequest ? `Manuscript request: ${question}

Retrieved records:
${evidenceBlock}

Specialist findings:
${specialistBlock}

Write the full, in-depth manuscript draft now. Use the required Markdown structure exactly, develop every section into substantial paragraphs, and cite factual claims inline with [S#] markers (exactly as shown in the retrieved records). Do not write a References section — inline [S#] citation is enough.`
        : `Question: ${question}

Retrieved records:
${evidenceBlock}

Specialist findings:
${specialistBlock}

Write the final, well-structured research answer now, citing [S#] markers (exactly as shown in the retrieved records) for every claim.`,
    },
  ];
  const res = await streamWithModelChain(
    model,
    {
      messages,
      temperature: paperRequest ? 0.18 : 0.25,
      maxTokens: paperRequest ? (mini ? 3000 : 8000) : mini ? 900 : 1600,
    },
    { onToken, signal },
    emitFailover,
  );
  return { content: stripLeakedSpecialistLabels(res.content), modelUsed: res.modelUsed };
}

// Remove internal specialist section labels the model sometimes echoes back as
// if they were citations (e.g. "[Specialist Findings - Pharmacology]"). They
// are pipeline scaffolding, not sources, and must never reach the rendered
// answer or its export.
export function stripLeakedSpecialistLabels(text: string): string {
  return text
    .replace(/\[\s*specialist findings[^\]]*\]/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:)])/g, '$1');
}
