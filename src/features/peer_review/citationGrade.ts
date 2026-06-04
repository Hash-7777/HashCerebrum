// Citation-faithfulness grading pass. Takes the claim/source pairs from
// citationAudit and asks a model to judge, for each claim, whether the cited
// source actually supports it. Batched + rate-limit-aware so it stays usable on
// a free tier, and degrades to a partial result rather than throwing. The
// reply parser is pure and unit-tested; only the orchestrator touches the LLM.

import { completeWithModelChain } from '@core/llm/ProviderRegistry';
import type { CitedClaim, FaithfulnessGrade } from './citationAudit';
import { isContextTooLarge, isRateLimited } from './reviewSwarm';

export interface FaithfulnessItem {
  sentence: string;
  markers: number[];
  grade: FaithfulnessGrade;
  note: string;
}

export interface CitationAudit {
  items: FaithfulnessItem[];
  counts: Record<FaithfulnessGrade, number>;
  /** How many claims were submitted for grading. */
  checked: number;
}

const BATCH = 6;
const MAX_RATE_RETRIES = 3;
const RATE_WAIT_CAP_MS = 25_000;
const SNIPPET_CHARS = 320;

const SYSTEM = `You are a citation-faithfulness checker for a biomedical manuscript. For each numbered claim you are given the claim sentence and the snippet(s) of the source(s) it cites. Judge ONLY from the provided snippet whether the source supports the claim. Do not use outside knowledge.

Grades:
- SUPPORTED — the snippet clearly backs the claim
- WEAK — the snippet is related but only loosely supports it
- OVERSTATED — the snippet supports a weaker version; the claim exaggerates
- UNSUPPORTED — the snippet does not address the claim's specifics
- CONTRADICTED — the snippet states the opposite

Reply with EXACTLY one line per claim, nothing else:
CLAIM <n>: <SUPPORTED|WEAK|OVERSTATED|UNSUPPORTED|CONTRADICTED> — <reason in 15 words or fewer>`;

const GRADE_WORDS: Record<string, FaithfulnessGrade> = {
  supported: 'supported',
  weak: 'weak',
  weakly: 'weak',
  overstated: 'overstated',
  unsupported: 'unsupported',
  contradicted: 'contradicted',
};

function emptyCounts(): Record<FaithfulnessGrade, number> {
  return { supported: 0, weak: 0, overstated: 0, unsupported: 0, contradicted: 0, unassessed: 0 };
}

/**
 * Parse the model reply for ONE batch into per-claim items. `batch` is the set
 * of claims sent (1-based `CLAIM n` lines map to batch[n-1]). Any claim the
 * model failed to grade is returned as `unassessed` ("not assessed") — a neutral
 * non-verdict, never silently dropped and never miscounted as a quality grade.
 */
export function parseFaithfulnessReply(text: string, batch: CitedClaim[]): FaithfulnessItem[] {
  const byIndex = new Map<number, { grade: FaithfulnessGrade; note: string }>();
  const lineRx = /claim\s*#?\s*(\d+)\s*[:.\-]\s*([a-z]+)\b[^A-Za-z0-9]*(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = lineRx.exec(text)) !== null) {
    const idx = Number(m[1]) - 1;
    const grade = GRADE_WORDS[(m[2] ?? '').toLowerCase()];
    if (!grade || idx < 0 || idx >= batch.length) continue;
    const note = (m[3] ?? '').replace(/^[\s—–-]+/, '').trim().slice(0, 160);
    byIndex.set(idx, { grade, note });
  }
  return batch.map((claim, i) => {
    const parsed = byIndex.get(i);
    return {
      sentence: claim.sentence,
      markers: claim.markers,
      grade: parsed?.grade ?? 'unassessed',
      note: parsed?.note || 'Not assessed.',
    };
  });
}

function buildUserPrompt(batch: CitedClaim[]): string {
  return batch
    .map((claim, i) => {
      const sources = claim.sources
        .map((s) => `  [${s.marker}] ${s.title}: ${s.snippet.slice(0, SNIPPET_CHARS)}`)
        .join('\n');
      return `CLAIM ${i + 1}: ${claim.sentence}\nSOURCE(S):\n${sources}`;
    })
    .join('\n\n');
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function retryAfterMs(err: unknown): number | null {
  const match = (err instanceof Error ? err.message : String(err)).match(/try again in\s+([\d.]+)\s*(ms|s)?/i);
  if (!match) return null;
  const v = Number(match[1]);
  if (!Number.isFinite(v)) return null;
  return Math.min(match[2]?.toLowerCase() === 'ms' ? v : v * 1000, RATE_WAIT_CAP_MS);
}

/**
 * Grade every cited claim. Batched and rate-limit-aware; on an exhausted
 * provider it returns whatever was graded so far (the remaining claims surface
 * as `weak`/"not assessed") instead of throwing.
 */
export async function gradeCitationFaithfulness(
  model: string,
  claims: CitedClaim[],
  signal?: AbortSignal,
): Promise<CitationAudit> {
  const items: FaithfulnessItem[] = [];
  for (let i = 0; i < claims.length; i += BATCH) {
    if (signal?.aborted) break;
    const batch = claims.slice(i, i + BATCH);
    let graded: FaithfulnessItem[] | null = null;
    let rateRetries = 0;
    for (;;) {
      try {
        const res = await completeWithModelChain(model, {
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: buildUserPrompt(batch) },
          ],
          temperature: 0.1,
          maxTokens: 700,
        });
        graded = parseFaithfulnessReply(res.content, batch);
        break;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') break;
        if (isContextTooLarge(err)) break; // can't shrink a batch usefully here
        if (isRateLimited(err) && rateRetries < MAX_RATE_RETRIES) {
          rateRetries += 1;
          const wait = retryAfterMs(err) ?? Math.min(RATE_WAIT_CAP_MS, 1_000 * 2 ** (rateRetries - 1));
          await sleep(wait + Math.floor(Math.random() * 300));
          continue;
        }
        break;
      }
    }
    // On failure, still surface the batch's claims as un-assessed.
    items.push(...(graded ?? batch.map((c) => ({ sentence: c.sentence, markers: c.markers, grade: 'weak' as const, note: 'Not assessed.' }))));
  }

  const counts = emptyCounts();
  for (const it of items) counts[it.grade] += 1;
  return { items, counts, checked: claims.length };
}
