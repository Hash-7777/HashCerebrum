// AI peer review engine — calls the boss model with a structured critic
// prompt to produce a scored, section-by-section critique of a research paper.

import { streamWithModelChain } from '@core/llm/ProviderRegistry';
import type { PaperReview } from '@core/store/peerReviewStore';

const MAX_TEXT_CHARS = 18_000;

const SYSTEM_PROMPT = `You are a senior peer reviewer for a high-impact biomedical journal. You have deep expertise in clinical research methodology, statistics, and publication ethics.

Your task is to review a research paper or manuscript draft and produce a structured, rigorous critique. Be honest, specific, and constructive. Do not be vague.

Produce your review in EXACTLY this format — every section heading on its own line, followed by the content:

SCORE: <integer 1-10>

SUMMARY:
<2-3 sentence overall assessment>

STRENGTHS:
- <specific strength>
- <specific strength>
- <specific strength>

WEAKNESSES:
- <specific weakness with page/section reference where possible>
- <specific weakness>
- <specific weakness>

METHODOLOGY:
<paragraph evaluating study design, search strategy, inclusion/exclusion criteria, bias risk>

STATISTICS:
<paragraph evaluating statistical methods, sample size justification, effect sizes, confidence intervals, p-value interpretation>

CONCLUSIONS:
<paragraph evaluating whether conclusions are supported by the evidence presented>

PUBLICATION READINESS:
<paragraph stating whether the paper is ready for submission, what major revisions are required, and which journal tier is appropriate>`;

function buildUserMessage(text: string): string {
  const truncated = text.length > MAX_TEXT_CHARS
    ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[... paper truncated to ${MAX_TEXT_CHARS} characters ...]`
    : text;
  return `Please review the following manuscript:\n\n---\n${truncated}\n---`;
}

export function parseScore(text: string): number {
  // Tolerate markdown emphasis and spacing around the score — the orchestrator
  // often writes "**SCORE:** 3 / 10", and the old /SCORE:\s*(\d+)/ could not
  // match across the asterisks, so it fell back to 5 while the body showed 3
  // (the ring-vs-body mismatch). Strip emphasis first, then read the integer.
  const clean = text.replace(/[*_`]/g, '');
  const match = /\bSCORE\b\s*:?\s*(\d+)/i.exec(clean);
  const n = match ? Number.parseInt(match[1]!, 10) : 5;
  return Math.max(1, Math.min(10, Number.isNaN(n) ? 5 : n));
}

// Match a section header anywhere it starts a line: the heading, a colon, then
// any whitespace (a newline OR a space — models often write "SUMMARY: text" on
// one line, which the old `${heading}:\n` match missed, dumping the raw reply
// into the summary). Case-insensitive for resilience.
function headerMatch(text: string, heading: string, from = 0): { index: number; end: number } | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp(`(?:^|\\n)[ \\t]*${escaped}[ \\t]*:[ \\t]*\\n?`, 'i');
  const m = rx.exec(text.slice(from));
  if (!m) return null;
  return { index: from + m.index, end: from + m.index + m[0].length };
}

function parseSection(text: string, heading: string, nextHeading: string | null): string {
  const h = headerMatch(text, heading);
  if (!h) return '';
  let end = text.length;
  if (nextHeading) {
    const n = headerMatch(text, nextHeading, h.end);
    if (n) end = n.index;
  }
  return text.slice(h.end, end).trim();
}

function parseBullets(block: string): string[] {
  return block
    .split('\n')
    .filter((line) => line.trimStart().startsWith('-'))
    .map((line) => line.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean);
}

export function parseReviewResponse(raw: string, modelUsed: string): PaperReview {
  const score = parseScore(raw);
  const summary = parseSection(raw, 'SUMMARY', 'STRENGTHS');
  const strengthsBlock = parseSection(raw, 'STRENGTHS', 'WEAKNESSES');
  // Handle both old format (WEAKNESSES → METHODOLOGY) and new format (WEAKNESSES → REPORTING CHECKLIST GAPS or METHODOLOGY)
  const weaknessesBlock = parseSection(raw, 'WEAKNESSES', 'REPORTING CHECKLIST GAPS') ||
    parseSection(raw, 'WEAKNESSES', 'METHODOLOGY');
  // New fields — gracefully absent in old reviews
  const checklistBlock  = parseSection(raw, 'REPORTING CHECKLIST GAPS', 'METHODOLOGY');
  const methodology     = parseSection(raw, 'METHODOLOGY', 'GRADE CERTAINTY') ||
    parseSection(raw, 'METHODOLOGY', 'STATISTICS');
  const gradeCertainty  = parseSection(raw, 'GRADE CERTAINTY', 'STATISTICS');
  const statistics      = parseSection(raw, 'STATISTICS', 'CONCLUSIONS');
  const conclusions     = parseSection(raw, 'CONCLUSIONS', 'PUBLICATION READINESS');
  const publishReadiness = parseSection(raw, 'PUBLICATION READINESS', null);

  // Merge checklist gaps and grade certainty into methodology for display in the
  // existing UI fields (backward-compatible — no store shape change needed).
  const fullMethodology = [
    methodology,
    checklistBlock ? `Reporting checklist gaps:\n${checklistBlock}` : '',
    gradeCertainty ? `GRADE evidence certainty: ${gradeCertainty}` : '',
  ].filter(Boolean).join('\n\n');

  return {
    score,
    summary: summary || raw.slice(0, 300),
    strengths: parseBullets(strengthsBlock),
    weaknesses: parseBullets(weaknessesBlock),
    methodology: fullMethodology || methodology,
    statistics,
    conclusions,
    publishReadiness,
    reviewedAt: new Date().toISOString(),
    modelUsed,
  };
}

export async function runPeerReview(
  model: string,
  paperText: string,
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<PaperReview> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserMessage(paperText) },
  ];

  let fullText = '';
  const res = await streamWithModelChain(
    model,
    { messages, temperature: 0.3, maxTokens: 1800 },
    {
      onToken: (delta) => {
        fullText += delta;
        onToken(delta);
      },
      signal,
    },
  );

  const finalText = res.content || fullText;
  return parseReviewResponse(finalText, res.modelUsed ?? model);
}
