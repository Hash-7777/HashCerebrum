// Fact-check an answer against its own citations. For every sentence that cites a
// source, ask the NLI model whether that source actually ENTAILS the sentence. A
// sentence whose best entailment falls below the threshold is flagged as "not
// clearly supported by its cited source".
//
// It only ANNOTATES — it never rewrites or deletes the answer — and it fails open:
// with no NLI model available (not vendored / not ready), or on any error, it
// reports nothing checked and nothing unsupported, so answers are unaffected.

import { splitSentences } from './honestyGuard';
import { ENTAILMENT_THRESHOLD } from '@core/rag/nli.config';
import { getNliProvider, type NliProvider } from '@core/rag/nli/workerClient';

interface CitedSource {
  snippet?: string | null;
}

export interface VerifyResult {
  /** How many cited sentences were actually checked (0 when the model is off). */
  checked: number;
  /** The cited sentences the NLI model did not find clearly supported. */
  unsupported: string[];
}

export interface VerifyDeps {
  provider?: NliProvider;
  threshold?: number;
}

const PREMISE_CHARS = 1500; // cap the source text handed to the model per check

/** Strip internal citation markers so the hypothesis is clean prose. */
function stripMarkers(sentence: string): string {
  return sentence.replace(/\[S?0*\d+\]/g, '').replace(/\s+/g, ' ').trim();
}

/** Indices (0-based) of the sources a sentence cites via [S#]/[#] markers. */
function citedIndices(sentence: string, count: number): number[] {
  const out = new Set<number>();
  for (const m of sentence.matchAll(/\[S?0*(\d+)\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= count) out.add(n - 1);
  }
  return [...out];
}

export async function verifyAnswer(
  answer: string,
  citations: CitedSource[],
  deps: VerifyDeps = {},
): Promise<VerifyResult> {
  const provider = deps.provider ?? getNliProvider();
  const threshold = deps.threshold ?? ENTAILMENT_THRESHOLD;
  if (!answer.trim() || citations.length === 0) return { checked: 0, unsupported: [] };

  // Gather each cited sentence with the source text (premise) it must be entailed by.
  const jobs: { sentence: string; hypothesis: string; premise: string }[] = [];
  for (const sentence of splitSentences(answer)) {
    const idx = citedIndices(sentence, citations.length);
    if (idx.length === 0) continue;
    const premise = idx
      .map((i) => citations[i]?.snippet ?? '')
      .filter(Boolean)
      .join(' ')
      .slice(0, PREMISE_CHARS);
    const hypothesis = stripMarkers(sentence);
    if (!premise || hypothesis.length < 12) continue;
    jobs.push({ sentence: sentence.trim(), hypothesis, premise });
  }
  if (jobs.length === 0) return { checked: 0, unsupported: [] };

  await provider.warmup();
  if (!provider.ready) return { checked: 0, unsupported: [] }; // fail open

  const unsupported: string[] = [];
  let checked = 0;
  // One NLI call per sentence (each has its own premise). Run concurrently; the
  // worker serialises the actual inference.
  const results = await Promise.all(
    jobs.map(async (job) => {
      try {
        const [score] = await provider.entailment(job.premise, [job.hypothesis]);
        return { job, score: score ?? null };
      } catch {
        return { job, score: null };
      }
    }),
  );
  for (const { job, score } of results) {
    if (score === null) continue; // an errored check is not counted (fail open)
    checked += 1;
    if (score < threshold) unsupported.push(job.sentence);
  }
  return { checked, unsupported };
}
