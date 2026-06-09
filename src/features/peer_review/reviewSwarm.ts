// Peer-review swarm — five specialised agents analyse a manuscript in
// parallel. Each streams its own output; the orchestrator result is also
// parsed into the full PaperReview shape.

import { streamWithModelChain } from '@core/llm/ProviderRegistry';
import { useAgentStore } from '@core/store/agentStore';
import type { AgentReviewResult, PaperReview } from '@core/store/peerReviewStore';
import { parseReviewResponse } from './reviewEngine';

/** Hard timeout (ms) for a SINGLE model call. Applied per request — not per
 *  agent — so a multi-part agent making steady progress is never killed, while
 *  one genuinely hung request still fails fast. Bounded retries (below) cap the
 *  total time an agent can spend. */
const CALL_TIMEOUT_MS = 70_000;

/** Review agents run ONE AT A TIME. The free tiers this app targets have very
 *  low token-per-minute budgets (e.g. Groq's 8000 TPM): a single review request
 *  is already 4–7k tokens, so even two in parallel instantly overflow the limit
 *  and every agent gets a 429. Serial execution lets the rolling TPM window
 *  recover between calls — the difference between "all agents failed" and a
 *  completed review. */
const REVIEW_CONCURRENCY = 1;

/** Bounded retries so a call always terminates. Shrinking is for genuine
 *  context-size rejections; backoff is for rate/quota limits. */
const MAX_SHRINK_RETRIES = 4;
const MAX_RATE_LIMIT_RETRIES = 4;
/** Cap on how long a single rate-limit backoff will wait. Providers sometimes
 *  report a "try again in 195s" cooldown; honouring that verbatim would stall
 *  the whole review, so we wait the smaller of the reported delay and this cap. */
const RATE_LIMIT_WAIT_CAP_MS = 25_000;

/** Parse a provider's suggested retry delay from a 429 message ("try again in
 *  8.7s", "Please try again in 13.635s") into milliseconds, capped. Returns
 *  null when no delay is advertised. */
function retryAfterMs(err: unknown): number | null {
  const m = err instanceof Error ? err.message : String(err);
  const match = m.match(/try again in\s+([\d.]+)\s*(ms|s)?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const ms = match[2]?.toLowerCase() === 'ms' ? value : value * 1000;
  return Math.min(ms, RATE_LIMIT_WAIT_CAP_MS);
}

/** Race a promise against a timeout rejection. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  // Store the timer ID so we can clear it when the real promise wins first —
  // otherwise the timer fires later and rejects an already-settled promise
  // (a silent no-op, but it leaks one timer per call).
  let timerId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timerId));
}

/** Promise-based delay that rejects with an AbortError if the signal fires. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function trace(phase: string, detail: string) {
  // Cast to satisfy AgentId | 'system' — peer-review uses 'system' sentinel
  useAgentStore.getState().push({ agentId: 'system', phase, detail });
}

const MAX_CHARS = 16_000;
// Floor for the adaptive shrink below — small enough to clear an 8k TPM model.
const MIN_CHARS = 4_000;

function truncate(text: string, max: number = MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... truncated to ${max} chars ...]`;
}

function userMsg(text: string, max: number = MAX_CHARS): string {
  return `Please analyse the following manuscript:\n\n---\n${truncate(text, max)}\n---`;
}

// Target size of each document part when the manuscript is reviewed in chunks.
// ~6k chars ≈ 1.5k tokens; with a long reviewer system prompt (~1.5k) and the
// model's reply, this keeps a single request well under an 8k token-per-minute
// budget so a low free tier can actually serve it.
const CHUNK_CHARS = 6_000;

// Split a manuscript into review-sized parts at paragraph boundaries, hard-
// splitting any single paragraph that is itself larger than the budget.
export function chunkDocument(text: string, size: number = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const para of text.split(/\n{2,}/)) {
    if (para.length > size) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      let idx = 0;
      while (idx < para.length) {
        let end = Math.min(idx + size, para.length);
        if (end < para.length) {
          const lastSpace = para.lastIndexOf(' ', end);
          if (lastSpace > idx) end = lastSpace;
        }
        chunks.push(para.slice(idx, end));
        idx = end;
      }
      continue;
    }
    if (current && current.length + para.length + 2 > size) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) chunks.push(current);
  return chunks;
}

// Maximum number of parts any one agent will review. A 12-section manuscript
// chunked at 6k chars is ~12 parts, and across the review agents that is dozens
// of calls — on a low free tier that meant a 10-minute, heavily rate-limited
// review.
const MAX_REVIEW_PARTS = 3;

// Reduce a manuscript to at most MAX_REVIEW_PARTS review chunks. A short paper
// is returned whole. A long one is condensed by proportionally trimming the
// MIDDLE of each over-long paragraph block — so every section is still
// represented (headings, opening and closing claims survive) — then re-chunked.
// This cuts an agent's calls ~4x without dropping any section entirely.
export function reviewParts(text: string, maxParts: number = MAX_REVIEW_PARTS): string[] {
  const full = chunkDocument(text);
  if (full.length <= maxParts) return full;
  const blocks = text.split(/\n{2,}/);
  const condenseTo = (budget: number): string =>
    blocks
      .map((block) => {
        const keep = Math.max(240, Math.floor((block.length * budget) / text.length));
        if (block.length <= keep) return block;
        const head = Math.ceil(keep * 0.6);
        const tail = keep - head;
        return `${block.slice(0, head)} […] ${block.slice(block.length - tail)}`;
      })
      .join('\n\n');
  // Tighten the budget until the condensed paper re-chunks to <= maxParts
  // (paragraph-boundary packing leaves slack, so one target rarely lands exact).
  let factor = 1;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const parts = chunkDocument(condenseTo(Math.floor(maxParts * CHUNK_CHARS * factor)));
    if (parts.length <= maxParts) return parts;
    factor *= 0.8;
  }
  return chunkDocument(condenseTo(Math.floor(maxParts * CHUNK_CHARS * 0.5))).slice(0, maxParts);
}

// A provider rejecting the request because the prompt is physically too big for
// the model's CONTEXT WINDOW (HTTP 413, "request too large", "context length").
// This is recoverable by shrinking the document.
export function isContextTooLarge(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes('413') ||
    m.includes('request too large') ||
    m.includes('reduce your message') ||
    m.includes('context length') ||
    m.includes('context_length') ||
    m.includes('maximum context') ||
    m.includes('too many tokens')
  );
}

// A provider — or every provider in the failover chain — refusing because of a
// RATE or QUOTA limit: requests-per-minute, tokens-per-minute, daily quota, or a
// cooldown after a recent 429. Shrinking the prompt does NOT help here; only
// waiting (or a fresh provider) does. Critically, a "tokens per minute" message
// is a rate limit, NOT a context-size error — misclassifying it sent the old
// code into a shrink loop that burned the whole timeout and failed every agent.
export function isRateLimited(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('quota') ||
    m.includes('requests per minute') ||
    m.includes('tokens per minute') ||
    m.includes('too many requests') ||
    m.includes('cooling down') ||
    m.includes('cooldown')
  );
}

function bullets(block: string): string[] {
  // De-duplicate identical points: an agent that reviews a manuscript in several
  // parts repeats the same observation (e.g. "STATISTICS SCORE: 3/10",
  // "AMSTAR-2: high concerns") once per part, which surfaced three identical
  // copies in the report. Keep the first occurrence only.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of block.split('\n')) {
    if (!/^\s*[-•*]/.test(line)) continue;
    const text = line.replace(/^\s*[-•*]\s*/, '').trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

// ── Agent system prompts ──────────────────────────────────────────────────

const ORCHESTRATOR_PROMPT = `You are a senior peer reviewer for a biomedical journal. Identify the study design, apply the matching EQUATOR guideline (PRISMA for reviews, CONSORT for RCTs, STROBE for observational, CARE for case reports), and assess GRADE certainty.

Format exactly:
SCORE: <1-10>
STUDY TYPE: <design>
REPORTING GUIDELINE: <checklist>
SUMMARY: <2-3 sentences>
STRENGTHS:
- <specific strength with section ref>
- ...
WEAKNESSES:
- <specific weakness with section ref>
- ...
REPORTING CHECKLIST GAPS:
- <missing item>
- ...
METHODOLOGY: <design, search, inclusion, bias assessment>
GRADE CERTAINTY: <High/Moderate/Low/Very Low — downgrade/upgrades>
STATISTICS: <methods, sample size, effect sizes, CIs, p-values, clinical vs statistical significance>
CONCLUSIONS: <supported? overclaiming? underclaiming?>
PUBLICATION READINESS: <ready/minor/major/reject + journal tier>`;

const ORIGINALITY_PROMPT = `You are an academic integrity reviewer. Check originality and attribution.

REPETITIVE CONTENT:
- [redundant points]
UNSUPPORTED CLAIMS:
- "[claim]" — needs evidence
VAGUE SECTIONS:
- [filler/template text]
ATTRIBUTION GAPS:
- [uncited claim implying prior work]

For fixes use:
"exact text" → "replacement"

ORIGINALITY ASSESSMENT: [paragraph on overall originality and evidence support]`;

const VOCABULARY_PROMPT = `You are a scientific writing specialist improving vocabulary.

For direct fixes use:
"exact text" → "replacement"

Sections:
OVERUSED WORDS:
- "[word]" → [syn1], [syn2]
INFORMAL → ACADEMIC:
- "[informal]" → "[academic]"
PRECISION IMPROVEMENTS:
- "[vague]" → "[precise]"
TERMINOLOGY CONSISTENCY:
- [inconsistent terms]
VOCABULARY SUMMARY: [1-2 sentences]`;

const STATISTICS_PROMPT = `You are a biostatistician reviewing quantitative content. Apply design-specific tools:
- RCTs → RoB 2 (randomisation, deviations, missing data, measurement, selective reporting)
- Observational → Newcastle-Ottawa Scale (selection, comparability, assessment)
- Reviews → AMSTAR-2 (search, exclusions, RoB, methods, publication bias, funding)

Sections:
STATISTICAL METHODS: [appropriate? design-method mismatch?]
REPORTING COMPLETENESS:
- Effect sizes: yes/no/partial
- CIs: yes/no/partial
- P-values: yes/no/partial
- Sample-size justification: yes/no/partial
- Absolute risks with relative: yes/no/na
RISK-OF-BIAS: [RoB 2 / NOS / AMSTAR-2 overall: Low/Some concerns/High]
SAMPLE SIZE & POWER: [adequacy assessment]
STATISTICAL INTERPRETATION: [correct conclusions? clinical vs statistical significance? causal overclaiming?]
DATA PRESENTATION: [tables/figures quality, missing denominators, inconsistent numbers]

For fixes use:
"exact text" → "replacement"

STATISTICS SCORE: <1-10>
[One-sentence verdict]`;

// Map-phase prompt for the orchestrator when a manuscript is reviewed in
// parts: gather concise observations per part (cheap, small output) which a
// final reduce pass then synthesises into the scored review.
const ORCHESTRATOR_NOTES_PROMPT = `You are a senior peer reviewer reading ONE PART of a larger manuscript. List concise, specific reviewer observations for THIS PART ONLY — methodology, reporting completeness, statistics, clarity, and any claims that need support. Use short bullet points. Do NOT assign a score and do NOT write section headings; a final pass will combine the notes from every part into the formal review.`;

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
    maxTokens: 2800,
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
    maxTokens: 1800,
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
  trace('start', `[Peer Review] swarm started — ${REVIEW_SWARM_AGENTS.length} agents`);

  // One model call with bounded recovery. Two failure modes are handled
  // distinctly (the old code conflated them and looped forever):
  //   • CONTEXT-too-large → shrink the document once per failure and retry,
  //     down to a floor, capped at MAX_SHRINK_RETRIES;
  //   • RATE/QUOTA limited → the provider chain is exhausted, so wait with
  //     jittered exponential backoff and retry, capped at MAX_RATE_LIMIT_RETRIES.
  // Each attempt is wrapped in a per-call timeout so a hung request fails fast
  // without killing a steadily-progressing agent.
  const callModel = async (
    system: string,
    user: string,
    maxTokens: number,
    label: string,
    onAcc?: (acc: string) => void,
  ): Promise<{ text: string; modelUsed: string }> => {
    let content = user;
    let shrinks = 0;
    let rateRetries = 0;
    for (;;) {
      let acc = '';
      try {
        const res = await withTimeout(
          streamWithModelChain(
            model,
            {
              messages: [
                { role: 'system' as const, content: system },
                { role: 'user' as const, content },
              ],
              temperature: 0.3,
              maxTokens,
            },
            {
              onToken: (delta) => {
                acc += delta;
                onAcc?.(acc);
              },
              signal,
            },
          ),
          CALL_TIMEOUT_MS,
          label,
        );
        return { text: res.content || acc, modelUsed: res.modelUsed ?? model };
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        if (isContextTooLarge(err) && !acc && content.length > MIN_CHARS && shrinks < MAX_SHRINK_RETRIES) {
          shrinks += 1;
          content = truncate(content, Math.max(MIN_CHARS, Math.floor(content.length / 2)));
          trace('tool_call', `[Peer Review] ${label}: prompt too large — retrying smaller`);
          continue;
        }
        if (isRateLimited(err) && !acc && rateRetries < MAX_RATE_LIMIT_RETRIES) {
          rateRetries += 1;
          // Prefer the provider's advertised cooldown ("try again in Xs",
          // capped) over a blind exponential — it is the real time the TPM
          // window needs to recover.
          const advertised = retryAfterMs(err);
          const backoff = Math.min(RATE_LIMIT_WAIT_CAP_MS, 1_000 * 2 ** (rateRetries - 1));
          const waitMs = (advertised ?? backoff) + Math.floor(Math.random() * 400);
          trace('tool_call', `[Peer Review] ${label}: rate-limited — pausing ${Math.round(waitMs / 1000)}s`);
          await sleep(waitMs, signal);
          continue;
        }
        throw err;
      }
    }
  };

  const agentTask = async (def: ReviewAgentDef) => {
    onPatch(def.agentId, { status: 'running', text: '', items: [] });
    trace('start', `[Peer Review] ${def.label} running`);
    const chunks = reviewParts(paperText);
    const multi = chunks.length > 1;
    let modelUsed = model;
    try {
      // The orchestrator scores the whole paper, so for a multi-part document
      // it gathers concise notes per part (map) and synthesises the final
      // scored review from those notes (reduce) — never sending the whole
      // manuscript in one oversized request.
      if (def.agentId === 'orchestrator' && multi) {
        trace('tool_call', `[Peer Review] ${def.label}: reviewing ${chunks.length} parts`);
        const notes: string[] = [];
        for (let i = 0; i < chunks.length; i += 1) {
          onPatch(def.agentId, { text: `Reviewing part ${i + 1} of ${chunks.length}…` });
          const r = await callModel(
            ORCHESTRATOR_NOTES_PROMPT,
            `Manuscript PART ${i + 1} of ${chunks.length}. List concise reviewer observations for THIS part only.\n\n---\n${chunks[i] ?? ''}\n---`,
            700,
            `${def.label} part ${i + 1}`,
          );
          modelUsed = r.modelUsed;
          notes.push(`Part ${i + 1} notes:\n${r.text}`);
        }
        const r = await callModel(
          def.systemPrompt,
          `The following reviewer notes were gathered across all ${chunks.length} parts of ONE manuscript. Produce the final review in the required format, basing the score and every section on these combined notes.\n\n---\n${truncate(notes.join('\n\n'))}\n---`,
          def.maxTokens,
          def.label,
          (acc) => onPatch(def.agentId, { text: acc }),
        );
        modelUsed = r.modelUsed;
        const parsed = bullets(r.text);
        onPatch(def.agentId, { status: 'done', text: r.text, items: parsed });
        trace('done', `[Peer Review] ${def.label} — ${parsed.length} items (${chunks.length} parts)`);
        return { agentId: def.agentId, text: r.text, modelUsed, error: undefined };
      }

      // Every other agent emits a flat list of issues, so it maps over the
      // parts and the per-part outputs are concatenated.
      let accumulated = '';
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i] ?? '';
        const user = multi
          ? `Please analyse PART ${i + 1} OF ${chunks.length} of the following manuscript. Report only issues found in THIS part.\n\n---\n${chunk}\n---`
          : userMsg(chunk);
        const base = accumulated;
        const r = await callModel(def.systemPrompt, user, def.maxTokens, def.label, (acc) =>
          onPatch(def.agentId, { text: base ? `${base}\n\n${acc}` : acc }),
        );
        modelUsed = r.modelUsed;
        accumulated = accumulated ? `${accumulated}\n\n${r.text}` : r.text;
        onPatch(def.agentId, { text: accumulated });
      }
      const parsed = bullets(accumulated);
      onPatch(def.agentId, { status: 'done', text: accumulated, items: parsed });
      trace('done', `[Peer Review] ${def.label} — ${parsed.length} items${multi ? ` (${chunks.length} parts)` : ''}`);
      return { agentId: def.agentId, text: accumulated, modelUsed, error: undefined };
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      onPatch(def.agentId, { status: 'error', error: errMsg });
      trace('error', `[Peer Review] ${def.label}: ${errMsg}`);
      return { agentId: def.agentId, text: '', modelUsed: model, error: errMsg };
    }
  };

  // Run the agents with a small concurrency cap instead of all at once, so the
  // free-tier provider keys are not slammed into a 429 storm. Order is
  // preserved; an AbortError propagates and aborts the whole review.
  const results = new Array<AgentRun>(REVIEW_SWARM_AGENTS.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= REVIEW_SWARM_AGENTS.length) return;
      const def = REVIEW_SWARM_AGENTS[i]!;
      try {
        results[i] = await agentTask(def);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') throw err;
        const errMsg = err instanceof Error ? err.message : String(err);
        onPatch(def.agentId, { status: 'error', error: errMsg });
        trace('error', `[Peer Review] ${def.label}: ${errMsg}`);
        results[i] = { agentId: def.agentId, text: '', modelUsed: model, error: errMsg };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(REVIEW_CONCURRENCY, REVIEW_SWARM_AGENTS.length) }, () => worker()),
  );

  // If every single agent failed, surface a clear, actionable error rather than
  // an empty review or a raw provider JSON dump. The dominant cause on free
  // tiers is the token-per-minute limit, so name that and what to do about it.
  if (results.every((r) => r?.error)) {
    const firstErr = results.find((r) => r?.error)?.error ?? 'All review agents failed';
    trace('error', `[Peer Review] all agents failed: ${firstErr}`);
    const rateLimited = results.some((r) => r?.error && isRateLimited(new Error(r.error)));
    throw new Error(
      rateLimited
        ? "Peer review couldn't complete: the selected model's free tier ran out of tokens-per-minute. Wait a minute and re-review, or switch to a higher-tier API key in Settings."
        : `Peer review failed: ${firstErr}`,
    );
  }

  trace('done', '[Peer Review] swarm complete — building report');
  return buildPaperReview(results, model);
}

// ── Report assembly ─────────────────────────────────────────────────────────

interface AgentRun {
  agentId: string;
  text: string;
  modelUsed: string;
  error: string | undefined;
}

const labelForAgent = (id: string): string =>
  REVIEW_SWARM_AGENTS.find((a) => a.agentId === id)?.label ?? id;

// When the orchestrator (the scored lead review) did not complete — usually
// because every provider was rate-limited — degrade gracefully: build a clearly
// labelled partial review from the specialist agents that DID finish, rather
// than returning an empty review or throwing away their work.
function synthesizeReviewFromSpecialists(results: AgentRun[], model: string): PaperReview {
  const done = results.filter((r) => !r.error && r.text && r.agentId !== 'orchestrator');
  const completed = done.map((r) => labelForAgent(r.agentId));
  const failed = results.filter((r) => r.error).map((r) => labelForAgent(r.agentId));
  const weaknesses = done.flatMap((r) => bullets(r.text)).slice(0, 12);
  const statistics = done.find((r) => r.agentId === 'statistics')?.text ?? '';
  const summary =
    `Partial review — the lead reviewer did not complete (likely provider rate limits). ` +
    `Compiled from: ${completed.join(', ') || 'no agents'}.` +
    (failed.length ? ` Not completed: ${failed.join(', ')}.` : '') +
    ` Re-run the review for a full scored assessment.`;
  return {
    score: 0,
    summary,
    strengths: [],
    weaknesses,
    methodology: '',
    statistics,
    conclusions: '',
    publishReadiness: 'Incomplete — re-run review',
    reviewedAt: new Date().toISOString(),
    modelUsed: done[0]?.modelUsed ?? model,
  };
}

// Assemble the PaperReview from the swarm results: the orchestrator's scored
// critique when it completed, otherwise a labelled partial built from the
// specialists. Either way every agent's output is attached for the UI.
export function buildPaperReview(results: AgentRun[], model: string): PaperReview {
  const orch = results.find((r) => r.agentId === 'orchestrator');
  const base =
    orch && orch.text && !orch.error
      ? parseReviewResponse(orch.text, orch.modelUsed || model)
      : synthesizeReviewFromSpecialists(results, model);

  const agentResults: AgentReviewResult[] = results.map((r) => ({
    agentId: r.agentId,
    label: labelForAgent(r.agentId),
    status: r.error ? ('error' as const) : ('done' as const),
    text: r.text,
    items: bullets(r.text),
    ...(r.error ? { error: r.error } : {}),
  }));
  return { ...base, agentResults };
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
    /["“”„]([^"“”„\n]{2,240})["“”„]\s*(?:→|->)\s*["“”„]([^"“”„\n]{2,500})["“”„]/g;

  // Pass 1 — extract explicit arrow-pair fixes ("original" → "replacement")
  for (const agent of agentResults) {
    if (agent.status === 'error' || !agent.text) continue;
    const type: SuggestionType = SUGGESTION_TYPE_MAP[agent.agentId] ?? 'style';
    arrowRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = arrowRe.exec(agent.text)) !== null) {
      const original  = match[1]!.trim();
      const suggested = match[2]!.trim();
      if (original === suggested || original.length === 0) continue;
      if (list.some((s) => s.agentId === agent.agentId && s.originalText === original)) continue;
      list.push({
        id: `sug-${crypto.randomUUID()}`,
        agentId: agent.agentId,
        type,
        description: agent.label,
        originalText: original,
        suggestedText: suggested,
        status: 'pending',
      });
    }
  }

  // Pass 2 — for agents that produced no arrow pairs, harvest their bullet-point
  // items (or the first meaningful lines of raw text) as unanchored suggestions.
  // These surface with a "Get Fix" button that asks the LLM to identify the
  // specific text and generate a replacement.
  for (const agent of agentResults) {
    if (agent.status !== 'done' || !agent.text) continue;
    // Skip if this agent already contributed anchored suggestions above
    if (list.some((s) => s.agentId === agent.agentId && s.originalText)) continue;
    const type: SuggestionType = SUGGESTION_TYPE_MAP[agent.agentId] ?? 'style';
    // Prefer extracted bullet items; fall back to first meaningful text lines
    const items =
      agent.items.length > 0
        ? agent.items
        : agent.text
            .split('\n')
            .map((l) => l.replace(/^\s*[-•*\d.]+\s*/, '').trim())
            .filter((l) => l.length > 15);
    for (const item of items.slice(0, 5)) {
      list.push({
        id: `sug-${crypto.randomUUID()}`,
        agentId: agent.agentId,
        type,
        description: item,
        originalText: '',   // unanchored — "Get Fix" will fill this in
        suggestedText: '',
        status: 'pending',
      });
    }
  }

  return list;
}
