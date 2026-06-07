/**
 * Claim Extractor — deterministic claim extraction from chunk text.
 *
 * Parses chunk text for explicit factual claims using regex heuristics.
 * Extracts: findings, effect values, sample sizes, study designs, populations.
 *
 * Zero model calls. Pure regex/heuristic processing.
 */

import type { RagChunk } from '../types';

export interface ExtractedClaim {
  id: string;
  text: string; // the verbatim claim sentence
  type: 'finding' | 'effect_size' | 'sample_size' | 'population' | 'method' | 'limitation';
  confidence: 'high' | 'medium' | 'low';
  sourceChunkId: string;
  // Optional structured fields
  sampleSize?: number;
  effectLabel?: string;
  effectValue?: string;
  pValue?: string;
  ci?: string;
}

const SENTENCE_RX = /[^.!?]+[.!?]+/g;

const FINDING_LEADERS = new Set([
  'found', 'showed', 'demonstrated', 'reported', 'observed', 'identified',
  'revealed', 'indicated', 'suggested', 'concluded', 'established',
  'significantly', 'increased', 'decreased', 'reduced', 'improved',
  'associated', 'correlated', 'linked', 'predicted', 'associated with',
]);

const LIMITATION_LEADERS = new Set([
  'limitation', 'limited', 'small sample', 'underpowered', 'retrospective',
  'observational', 'confounding', 'selection bias', 'recall bias',
  'single-center', 'lack of', 'insufficient', 'incomplete',
]);

const POPULATION_RX = /\b(?:patients|participants|subjects|adults|children|men|women|individuals)\s+(?:with|receiving|undergoing|diagnosed with)\s+[^.;]{10,120}/i;
const SAMPLE_RX = /\b(?:n|N)\s*=\s*([0-9][0-9,]+)|\b([0-9][0-9,]+)\s+(?:patients|participants|subjects)\b/i;
const EFFECT_RX = /\b(?:odds ratio|or|risk ratio|relative risk|rr|hazard ratio|hr|mean difference|md|standardi[sz]ed mean difference|smd)\s*(?:=|:)?\s*([0-9]+(?:\.[0-9]+)?)/i;
const PVALUE_RX = /\bp\s*(?:=|<|>)\s*(0?\.[0-9]+)\b/i;
const CI_RX = /\b95%\s*CI\s*[:(]?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:-|to|,)\s*([0-9]+(?:\.[0-9]+)?)\)?/i;

function hashClaim(text: string, chunkId: string): string {
  let h = 0;
  const s = `${chunkId}:${text}`;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return `claim-${Math.abs(h).toString(36)}`;
}

function classifySentence(sentence: string): ExtractedClaim['type'] {
  const lower = sentence.toLowerCase();
  if ([...LIMITATION_LEADERS].some((w) => lower.includes(w))) return 'limitation';
  if (POPULATION_RX.test(sentence)) return 'population';
  if (SAMPLE_RX.test(sentence)) return 'sample_size';
  if (EFFECT_RX.test(sentence) || PVALUE_RX.test(sentence) || CI_RX.test(sentence)) return 'effect_size';
  const words = lower.split(/\s+/);
  if (words.some((w) => FINDING_LEADERS.has(w))) return 'finding';
  if (/\b(method|design|randomi[sz]ed|cohort|trial|study)\b/.test(lower)) return 'method';
  return 'finding';
}

function extractSampleSize(sentence: string): number | undefined {
  const m = sentence.match(SAMPLE_RX);
  if (!m) return undefined;
  const raw = (m[1] ?? m[2] ?? '').replace(/,/g, '');
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function extractEffectValue(sentence: string): { label?: string; value?: string } {
  const m = sentence.match(EFFECT_RX);
  if (m) {
    const label = m[0]!.split(/\s*(?:=|:)\s*/)[0]!.trim();
    const value = m[1];
    return value ? { label, value } : { label };
  }
  return {};
}

function extractPValue(sentence: string): string | undefined {
  const m = sentence.match(PVALUE_RX);
  return m?.[1];
}

function extractCI(sentence: string): string | undefined {
  const m = sentence.match(CI_RX);
  return m ? `${m[1]} to ${m[2]}` : undefined;
}

export function extractClaims(chunk: RagChunk): ExtractedClaim[] {
  const text = chunk.text;
  const sentences = text.match(SENTENCE_RX) ?? [text];
  const claims: ExtractedClaim[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 20) continue;

    const type = classifySentence(trimmed);
    const confidence: ExtractedClaim['confidence'] =
      type === 'effect_size' || type === 'sample_size' ? 'high' : 'medium';

    const claim: ExtractedClaim = {
      id: hashClaim(trimmed, chunk.id),
      text: trimmed,
      type,
      confidence,
      sourceChunkId: chunk.id,
    };

    if (type === 'sample_size') {
      const ss = extractSampleSize(trimmed);
      if (ss !== undefined) claim.sampleSize = ss;
    }
    if (type === 'effect_size') {
      const ev = extractEffectValue(trimmed);
      if (ev.label !== undefined) claim.effectLabel = ev.label;
      if (ev.value !== undefined) claim.effectValue = ev.value;
      const pv = extractPValue(trimmed);
      if (pv !== undefined) claim.pValue = pv;
      const ci = extractCI(trimmed);
      if (ci !== undefined) claim.ci = ci;
    }

    claims.push(claim);
  }

  return claims;
}

export function extractClaimsFromChunks(chunks: RagChunk[]): ExtractedClaim[] {
  return chunks.flatMap((chunk) => extractClaims(chunk));
}
