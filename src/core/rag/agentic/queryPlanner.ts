/**
 * Query Planner — decomposes a user query into targeted sub-queries.
 *
 * Uses a single lightweight model call when a provider is available,
 * with a deterministic regex/heuristic fallback for offline or
 * failure cases. The planner extracts concepts, hypotheses, and
 * sub-queries so downstream retrieval can be more thorough.
 *
 * One model call max per query. Falls back to deterministic decomposition.
 */

import { completeWithModelChain } from '@core/llm/ProviderRegistry';

export interface QueryPlan {
  subQueries: string[];
  hypotheses: string[];
  concepts: string[];
  reasoning: string;
}

// Common stop words to filter from deterministic concept extraction
const STOP = new Set([
  'about', 'after', 'against', 'among', 'and', 'any', 'are', 'between', 'both',
  'compare', 'comparison', 'does', 'effect', 'effects', 'evidence', 'for', 'from',
  'have', 'high', 'how', 'into', 'its', 'low', 'more', 'most', 'only', 'over',
  'patient', 'patients', 'research', 'review', 'risk', 'safety', 'than', 'that',
  'their', 'them', 'these', 'this', 'those', 'they', 'using', 'versus', 'what',
  'which', 'with', 'within', 'your', 'make', 'write', 'draft', 'create', 'generate',
  'produce', 'compose', 'prepare', 'give', 'want', 'need', 'please', 'full',
  'complete', 'comprehensive', 'detailed', 'thorough', 'professional',
  'publishable', 'proper', 'manuscript', 'article', 'report', 'document',
  'regarding', 'concerning', 'statistics', 'statistical', 'stats', 'numbers',
  'numeric', 'data', 'analysis', 'long', 'short', 'term', 'run', 'time',
  'duration', 'people', 'individual', 'individuals', 'population', 'treatment',
  'therapy', 'intervention', 'disease', 'condition', 'disorder', 'outcome',
  'result', 'finding', 'association', 'relationship', 'the', 'was', 'were',
  'been', 'have', 'had', 'has', 'did', 'done',
]);

const MEDICAL_SYNONYMS: Record<string, string[]> = {
  renal: ['kidney'],
  kidney: ['renal'],
  cardiac: ['heart', 'cardiovascular'],
  heart: ['cardiac', 'cardiovascular'],
  cardiovascular: ['cardiac', 'heart'],
  hepatic: ['liver'],
  liver: ['hepatic'],
  pulmonary: ['lung'],
  lung: ['pulmonary'],
  statin: ['hmg-coa reductase inhibitor'],
  statins: ['hmg-coa reductase inhibitors'],
  diabetes: ['diabetic', 'hyperglycemia', 't2dm', 't1dm'],
  hypertension: ['high blood pressure', 'htn'],
  obesity: ['overweight', 'bmi', 'adiposity'],
  warfarin: ['vitamin k antagonist'],
  aspirin: ['acetylsalicylic acid', 'asa'],
  nsaid: ['nonsteroidal anti-inflammatory'],
  nsaids: ['nonsteroidal anti-inflammatory drugs'],
};

function buildPlanPrompt(query: string): string {
  return (
    `Decompose this biomedical research query into a structured plan. ` +
    `Respond ONLY with valid JSON matching this shape:\n` +
    `{\n  "subQueries": ["..."],\n  "hypotheses": ["..."],\n  "concepts": ["..."],\n  "reasoning": "..."\n}\n\n` +
    `Rules:\n` +
    `- subQueries: 2-4 focused search queries that together cover the question.\n` +
    `- hypotheses: 1-3 testable hypotheses implied by the question.\n` +
    `- concepts: 3-8 key biomedical concepts (drugs, conditions, outcomes).\n` +
    `- reasoning: one sentence explaining the decomposition strategy.\n` +
    `- No markdown, no commentary, pure JSON.\n\n` +
    `Query: "${query.replace(/"/g, "'")}"`
  );
}

function parsePlanReply(raw: string, originalQuery: string): QueryPlan {
  let text = raw.trim();

  // Strip markdown code fences
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Try JSON parse first
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      subQueries: Array.isArray(parsed.subQueries) ? parsed.subQueries.filter((s): s is string => typeof s === 'string') : [],
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses.filter((s): s is string => typeof s === 'string') : [],
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts.filter((s): s is string => typeof s === 'string') : [],
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'parsed from model output',
    };
  } catch {
    /* fall through to heuristic */
  }

  // Heuristic: extract quoted strings as sub-queries
  const quoted = [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((s) => s.length > 5);

  // Heuristic: extract lines that look like list items
  const lines = text
    .split(/\n/)
    .map((l) => l.replace(/^\s*[-*\d.]+\s*/, '').trim())
    .filter((l) => l.length > 5 && l.length < 200);

  const subQueries = quoted.length >= 2 ? quoted.slice(0, 4) : lines.slice(0, 4);
  return {
    subQueries,
    hypotheses: [],
    concepts: extractConceptsHeuristic(originalQuery),
    reasoning: 'heuristic fallback parse',
  };
}

function extractConceptsHeuristic(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  const uniq = [...new Set(words)];
  // Expand with synonyms
  const expanded = new Set<string>();
  for (const w of uniq) {
    expanded.add(w);
    for (const syn of MEDICAL_SYNONYMS[w] ?? []) expanded.add(syn);
  }
  return [...expanded].slice(0, 8);
}

export function deterministicPlan(query: string): QueryPlan {
  const concepts = extractConceptsHeuristic(query);
  const subQueries =
    concepts.length >= 2
      ? concepts.slice(0, 3).map((c) => `${c} ${query}`)
      : [query, `mechanism ${query}`, `clinical trial ${query}`, `safety ${query}`];
  return {
    subQueries: subQueries.slice(0, 4),
    hypotheses: [`${query} has a measurable effect.`],
    concepts: concepts.slice(0, 6),
    reasoning: 'deterministic decomposition (no model available)',
  };
}

export async function planQuery(query: string, model?: string): Promise<QueryPlan> {
  if (!model || !query.trim()) return deterministicPlan(query);
  try {
    const reply = await completeWithModelChain(model, {
      messages: [{ role: 'user', content: buildPlanPrompt(query) }],
      temperature: 0.2,
      maxTokens: 600,
    });
    return parsePlanReply(reply.content, query);
  } catch {
    return deterministicPlan(query);
  }
}
