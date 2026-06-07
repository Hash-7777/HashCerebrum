/**
 * Conflict Detector — deterministic contradiction detection between claims.
 *
 * Compares extracted claims for directional contradictions:
 * - "increased" vs "decreased" on the same topic
 * - "effective" vs "no effect" on the same intervention
 * - Effect-size direction conflicts
 *
 * Zero model calls. Uses keyword overlap and directional signal comparison.
 */

import type { ExtractedClaim } from './claimExtractor';

export interface ClaimConflict {
  claimA: string; // claim id
  claimB: string; // claim id
  textA: string;
  textB: string;
  type: 'directional' | 'effectiveness' | 'magnitude' | 'population';
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}

const POSITIVE_SIGNALS = new Set([
  'increased', 'increase', 'higher', 'elevated', 'improved', 'improvement',
  'beneficial', 'effective', 'efficacious', 'reduced mortality', 'lower risk',
  'significant benefit', 'superior', 'better outcome', 'positive',
]);

const NEGATIVE_SIGNALS = new Set([
  'decreased', 'decrease', 'lower', 'reduced', 'reduction', 'decline',
  'worsened', 'worsening', 'harmful', 'ineffective', 'no effect',
  'no significant', 'not effective', 'non-significant', 'inferior',
  'worse outcome', 'negative', 'no benefit', 'no improvement',
]);

const NEUTRAL_SIGNALS = new Set([
  'no difference', 'similar', 'comparable', 'equivalent', 'non-inferior',
  'not significantly different', 'comparable efficacy',
]);

/** Extract a topic fingerprint from claim text — keywords minus directional words. */
function topicFingerprint(text: string): string[] {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  const exclude = new Set([...POSITIVE_SIGNALS, ...NEGATIVE_SIGNALS, ...NEUTRAL_SIGNALS, 'the', 'that', 'with', 'from', 'were', 'was', 'been', 'have', 'had', 'this', 'these', 'those', 'they', 'them']);
  return [...new Set(words.filter((w) => !exclude.has(w)))];
}

function topicOverlap(a: string, b: string): number {
  const fa = new Set(topicFingerprint(a));
  const fb = new Set(topicFingerprint(b));
  if (fa.size === 0 || fb.size === 0) return 0;
  let shared = 0;
  for (const w of fa) if (fb.has(w)) shared += 1;
  return shared / Math.min(fa.size, fb.size);
}

function directionalSignal(text: string): 'positive' | 'negative' | 'neutral' | 'unknown' {
  const lower = text.toLowerCase();
  const pos = [...POSITIVE_SIGNALS].filter((s) => lower.includes(s)).length;
  const neg = [...NEGATIVE_SIGNALS].filter((s) => lower.includes(s)).length;
  const neu = [...NEUTRAL_SIGNALS].filter((s) => lower.includes(s)).length;

  if (neu > 0 && pos === 0 && neg === 0) return 'neutral';
  if (pos > 0 && neg === 0) return 'positive';
  if (neg > 0 && pos === 0) return 'negative';
  if (pos > 0 && neg > 0) return 'neutral'; // mixed signals
  return 'unknown';
}

function effectivenessSignal(text: string): 'effective' | 'ineffective' | 'neutral' | 'unknown' {
  const lower = text.toLowerCase();
  // Check negative signals first so "not effective" is not misread as "effective".
  if (/\b(ineffective|no effect|no benefit|not effective|non-significant|no significant|no improvement)\b/.test(lower)) return 'ineffective';
  if (/\b(effective|efficacious|benefit|improved|superior)\b/.test(lower)) return 'effective';
  if (/\b(no difference|similar|comparable|equivalent|non-inferior)\b/.test(lower)) return 'neutral';
  return 'unknown';
}

function isContradictory(a: string, b: string): { isConflict: boolean; type: ClaimConflict['type']; severity: ClaimConflict['severity']; explanation: string } | undefined {
  const overlap = topicOverlap(a, b);
  if (overlap < 0.3) return undefined; // Different topics — not a conflict

  // Effectiveness conflict: effective vs ineffective on same intervention
  // Checked first because it is more specific than directional signal overlap.
  const effA = effectivenessSignal(a);
  const effB = effectivenessSignal(b);
  if (effA !== 'unknown' && effB !== 'unknown' && effA !== effB) {
    return {
      isConflict: true,
      type: 'effectiveness',
      severity: overlap > 0.6 ? 'high' : 'medium',
      explanation: `Effectiveness conflict: one claim states "${effA}" while another states "${effB}" on overlapping topics.`,
    };
  }

  // Directional conflict: increased vs decreased on same topic
  const dirA = directionalSignal(a);
  const dirB = directionalSignal(b);
  if (dirA !== 'unknown' && dirB !== 'unknown' && dirA !== dirB && dirA !== 'neutral' && dirB !== 'neutral') {
    return {
      isConflict: true,
      type: 'directional',
      severity: overlap > 0.6 ? 'high' : 'medium',
      explanation: `Directional conflict: one claim signals "${dirA}" while the other signals "${dirB}" on overlapping topics.`,
    };
  }

  return undefined;
}

export function detectConflicts(claims: ExtractedClaim[]): ClaimConflict[] {
  const conflicts: ClaimConflict[] = [];
  for (let i = 0; i < claims.length; i += 1) {
    for (let j = i + 1; j < claims.length; j += 1) {
      const a = claims[i]!;
      const b = claims[j]!;
      // Skip if from same chunk (internal consistency assumed)
      if (a.sourceChunkId === b.sourceChunkId) continue;
      const result = isContradictory(a.text, b.text);
      if (result) {
        conflicts.push({
          claimA: a.id,
          claimB: b.id,
          textA: a.text,
          textB: b.text,
          type: result.type,
          severity: result.severity,
          explanation: result.explanation,
        });
      }
    }
  }
  return conflicts;
}
