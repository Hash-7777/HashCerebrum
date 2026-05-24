// Peer-review swarm — five specialised agents analyse a manuscript in
// parallel. Each streams its own output; the orchestrator result is also
// parsed into the full PaperReview shape.

import { streamWithModelChain } from '@core/llm/ProviderRegistry';
import { useAgentStore } from '@core/store/agentStore';
import type { AgentReviewResult, PaperReview } from '@core/store/peerReviewStore';
import { parseReviewResponse } from './reviewEngine';

/** Per-agent hard timeout (ms). If an agent takes longer it is marked as failed. */
const AGENT_TIMEOUT_MS = 55_000;

/** Race a promise against a timeout rejection. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

function trace(phase: string, detail: string) {
  // Cast to satisfy AgentId | 'system' — peer-review uses 'system' sentinel
  useAgentStore.getState().push({ agentId: 'system', phase, detail });
}

const MAX_CHARS = 16_000;

function truncate(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}\n\n[... truncated to ${MAX_CHARS} chars ...]`;
}

function userMsg(text: string): string {
  return `Please analyse the following manuscript:\n\n---\n${truncate(text)}\n---`;
}

function bullets(block: string): string[] {
  return block
    .split('\n')
    .filter((l) => /^\s*[-•*]/.test(l))
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean);
}

// ── Agent system prompts ──────────────────────────────────────────────────

const ORCHESTRATOR_PROMPT = `You are a senior peer reviewer for a high-impact biomedical journal with deep expertise in clinical research methodology, statistics, and publication ethics. Produce a rigorous, structured critique in EXACTLY this format:

SCORE: <integer 1-10>

SUMMARY:
<2-3 sentence overall assessment>

STRENGTHS:
- <specific strength>
- <specific strength>
- <specific strength>

WEAKNESSES:
- <specific weakness with section reference where possible>
- <specific weakness>
- <specific weakness>

METHODOLOGY:
<paragraph on study design, search strategy, inclusion/exclusion criteria, bias risk>

STATISTICS:
<paragraph on statistical methods, sample size, effect sizes, confidence intervals, p-value interpretation>

CONCLUSIONS:
<paragraph on whether conclusions are supported by evidence>

PUBLICATION READINESS:
<state whether ready for submission, major revisions needed, and appropriate journal tier>`;

const GRAMMAR_PROMPT = `You are a professional biomedical copyeditor. Analyse the manuscript for spelling, grammar, and language quality.

Identify issues under these headings — be specific, quote the problematic text:

SPELLING ERRORS:
- "[wrong]" → "[correction]" — context

GRAMMAR ISSUES:
- [description] — context

CLARITY PROBLEMS:
- [ambiguous or unclear sentence]

STYLE SUGGESTIONS:
- [wordiness / passive overuse / jargon to simplify]

LANGUAGE QUALITY:
[1–2 sentence summary and letter grade A–F]`;

const ORIGINALITY_PROMPT = `You are an academic integrity reviewer. Analyse the manuscript for originality and proper evidence attribution.

Check for:

REPETITIVE CONTENT:
- [points stated multiple times without adding value]

UNSUPPORTED CLAIMS:
- "[claim]" — needs citation or evidence

VAGUE OR BOILERPLATE SECTIONS:
- [section that reads like filler or template text]

ATTRIBUTION GAPS:
- [claim that implies prior work but cites nothing]

ORIGINALITY ASSESSMENT:
[paragraph summarising overall originality and completeness of evidence support]`;

const VOCABULARY_PROMPT = `You are a scientific writing specialist improving vocabulary and terminology in a research manuscript.

Produce these sections:

OVERUSED WORDS (with synonym suggestions):
- "[word/phrase]" → alternatives: [syn1], [syn2], [syn3]

INFORMAL → ACADEMIC:
- "[informal phrase]" → "[academic equivalent]"

PRECISION IMPROVEMENTS:
- "[vague term]" → "[more precise term]"

TERMINOLOGY CONSISTENCY:
- [note any inconsistent use of key terms across the manuscript]

VOCABULARY SUMMARY:
[1–2 sentence assessment of the manuscript's vocabulary level and improvement priority]`;

const STATISTICS_PROMPT = `You are a biostatistician reviewing the quantitative content of a research manuscript.

Evaluate:

STATISTICAL METHODS:
[Are the chosen methods appropriate for the study design?]

REPORTING COMPLETENESS:
- Effect sizes reported: yes/no/partial
- Confidence intervals: yes/no/partial
- P-values: yes/no/partial
- Sample size justification: yes/no/partial

SAMPLE SIZE & POWER:
[Assessment of sample size discussion and study power]

STATISTICAL INTERPRETATION:
[Are conclusions drawn correctly from the numbers? Any over-interpretation?]

DATA PRESENTATION:
[Quality of tables, figures, and numeric reporting]

STATISTICS SCORE: <integer 1-10>
[One sentence overall verdict]`;

// ── Agent roster ──────────────────────────────────────────────────────────

export interface ReviewAgentDef {
  agentId: string;
  label: string;
  iconName: string;
  systemPrompt: string;
  maxTokens: number;
}

export const REVIEW_SWARM_AGENTS: ReviewAgentDef[] = [
  {
    agentId: 'orchestrator',
    label: 'The Cerebrum',
    iconName: 'shield',
    systemPrompt: ORCHESTRATOR_PROMPT,
    maxTokens: 2000,
  },
  {
    agentId: 'grammar',
    label: 'Grammar & Language',
    iconName: 'edit',
    systemPrompt: GRAMMAR_PROMPT,
    maxTokens: 1400,
  },
  {
    agentId: 'originality',
    label: 'Originality Check',
    iconName: 'search',
    systemPrompt: ORIGINALITY_PROMPT,
    maxTokens: 1200,
  },
  {
    agentId: 'vocabulary',
    label: 'Vocabulary & Style',
    iconName: 'document',
    systemPrompt: VOCABULARY_PROMPT,
    maxTokens: 1200,
  },
  {
    agentId: 'statistics',
    label: 'Statistics & Data',
    iconName: 'activity',
    systemPrompt: STATISTICS_PROMPT,
    maxTokens: 1400,
  },
];

// ── Swarm runner ──────────────────────────────────────────────────────────

export type OnAgentPatch = (agentId: string, patch: Partial<AgentReviewResult>) => void;

export function initialSwarmAgents(): AgentReviewResult[] {
  return REVIEW_SWARM_AGENTS.map((def) => ({
    agentId: def.agentId,
    label: def.label,
    status: 'idle' as const,
    text: '',
    items: [],
  }));
}

export async function runReviewSwarm(
  model: string,
  paperText: string,
  onPatch: OnAgentPatch,
  signal?: AbortSignal,
): Promise<PaperReview> {
  const msg = userMsg(paperText);

  trace('start', `[Peer Review] swarm started — ${REVIEW_SWARM_AGENTS.length} agents`);

  const agentTask = async (def: ReviewAgentDef) => {
    onPatch(def.agentId, { status: 'running', text: '', items: [] });
    trace('start', `[Peer Review] ${def.label} running`);
    let accumulated = '';
    try {
      const res = await streamWithModelChain(
        model,
        {
          messages: [
            { role: 'system' as const, content: def.systemPrompt },
            { role: 'user' as const, content: msg },
          ],
          temperature: 0.3,
          maxTokens: def.maxTokens,
        },
        {
          onToken: (delta) => {
            accumulated += delta;
            onPatch(def.agentId, { text: accumulated });
          },
          signal,
        },
      );
      const finalText = res.content || accumulated;
      const parsed = bullets(finalText);
      onPatch(def.agentId, { status: 'done', text: finalText, items: parsed });
      trace('done', `[Peer Review] ${def.label} — ${parsed.length} items`);
      return { agentId: def.agentId, text: finalText, modelUsed: res.modelUsed ?? model, error: undefined };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      onPatch(def.agentId, { status: 'error', error: errMsg });
      trace('error', `[Peer Review] ${def.label}: ${errMsg}`);
      return { agentId: def.agentId, text: accumulated, modelUsed: model, error: errMsg };
    }
  };

  const tasks = REVIEW_SWARM_AGENTS.map((def) =>
    withTimeout(agentTask(def), AGENT_TIMEOUT_MS, def.label).catch((err) => {
      if ((err as Error)?.name === 'AbortError') throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      onPatch(def.agentId, { status: 'error', error: errMsg });
      trace('error', `[Peer Review] ${def.label}: ${errMsg}`);
      return { agentId: def.agentId, text: '', modelUsed: model, error: errMsg };
    }),
  );

  const results = await Promise.all(tasks);

  // If every single agent failed, surface an error rather than an empty review
  const allFailed = results.every((r) => r.error);
  if (allFailed) {
    const firstErr = results[0]?.error ?? 'All review agents failed';
    trace('error', `[Peer Review] all agents failed: ${firstErr}`);
    throw new Error(`Peer review failed: ${firstErr}`);
  }

  trace('done', '[Peer Review] swarm complete — building report');

  // Build PaperReview from orchestrator
  const orch = results.find((r) => r.agentId === 'orchestrator');
  const review = parseReviewResponse(orch?.text ?? '', orch?.modelUsed ?? model);

  // Attach per-agent results
  const agentResults: AgentReviewResult[] = results.map((r, i) => ({
    agentId: r.agentId,
    label: REVIEW_SWARM_AGENTS[i]!.label,
    status: r.error ? ('error' as const) : ('done' as const),
    text: r.text,
    items: bullets(r.text),
    ...(r.error ? { error: r.error } : {}),
  }));

  return { ...review, agentResults };
}

// ── Suggestion types & parser ─────────────────────────────────────────────

export type SuggestionType =
  | 'grammar'
  | 'vocabulary'
  | 'style'
  | 'originality'
  | 'statistics'
  | 'general';

export interface Suggestion {
  id: string;
  agentId: string;
  type: SuggestionType;
  /** Human-readable label from the agent (e.g. "Grammar & Language"). */
  description: string;
  /** The exact text that appears in the document (to anchor the highlight). */
  originalText: string;
  /** Proposed replacement. Empty string means the fix hasn't been generated yet. */
  suggestedText: string;
  status: 'pending' | 'accepted' | 'skipped' | 'fixing';
}

const SUGGESTION_TYPE_MAP: Record<string, SuggestionType> = {
  grammar: 'grammar',
  vocabulary: 'vocabulary',
  originality: 'originality',
  statistics: 'statistics',
  orchestrator: 'general',
};

/**
 * Scan completed agent outputs for arrow-pair suggestions:
 *   "original text" → "replacement text"
 * Works with ASCII and curly/typographic quotes.
 */
export function parseSuggestions(agentResults: AgentReviewResult[]): Suggestion[] {
  const list: Suggestion[] = [];
  // Matches: "A" → "B" or "A" -> "B" with ASCII or curly/German quotes
  const arrowRe =
    /["""„]([^"""„\n]{2,120})["""„]\s*(?:→|->)\s*["""„]([^"""„\n]{2,300})["""„]/g;

  for (const agent of agentResults) {
    if (agent.status === 'error' || !agent.text) continue;
    const type: SuggestionType = SUGGESTION_TYPE_MAP[agent.agentId] ?? 'style';
    arrowRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = arrowRe.exec(agent.text)) !== null) {
      const original  = match[1]!.trim();
      const suggested = match[2]!.trim();
      if (original === suggested || original.length === 0) continue;
      // De-duplicate within the same agent
      if (list.some((s) => s.agentId === agent.agentId && s.originalText === original)) continue;
      list.push({
        id: `sug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        agentId: agent.agentId,
        type,
        description: agent.label,
        originalText: original,
        suggestedText: suggested,
        status: 'pending',
      });
    }
  }
  return list;
}
