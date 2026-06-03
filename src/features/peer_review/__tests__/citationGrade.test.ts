import { describe, expect, it } from 'vitest';
import type { CitedClaim } from '../citationAudit';
import { parseFaithfulnessReply } from '../citationGrade';

const batch: CitedClaim[] = [
  { sentence: 'NSAIDs raise bleeding risk with warfarin.', markers: [1], sources: [{ marker: 1, title: 'A', snippet: 'x' }] },
  { sentence: 'Grapefruit always doubles INR.', markers: [2], sources: [{ marker: 2, title: 'B', snippet: 'y' }] },
  { sentence: 'The drug cures the disease.', markers: [3], sources: [{ marker: 3, title: 'C', snippet: 'z' }] },
];

describe('parseFaithfulnessReply', () => {
  it('maps CLAIM lines to grades and reasons', () => {
    const reply = [
      'CLAIM 1: SUPPORTED — meta-analysis shows higher bleeding',
      'CLAIM 2: OVERSTATED — source says occasional, not always',
      'CLAIM 3: CONTRADICTED — source reports no cure',
    ].join('\n');
    const items = parseFaithfulnessReply(reply, batch);
    expect(items.map((i) => i.grade)).toEqual(['supported', 'overstated', 'contradicted']);
    expect(items[0]!.note).toContain('bleeding');
    expect(items[0]!.markers).toEqual([1]);
  });

  it('tolerates format noise (#, period, weakly) and maps "weakly" to weak', () => {
    const reply = 'CLAIM #1. WEAKLY supported - loosely related\nCLAIM 2: UNSUPPORTED — not addressed';
    const items = parseFaithfulnessReply(reply, batch);
    expect(items[0]!.grade).toBe('weak');
    expect(items[1]!.grade).toBe('unsupported');
  });

  it('marks any claim the model did not grade as weak / not assessed', () => {
    const items = parseFaithfulnessReply('CLAIM 1: SUPPORTED — ok', batch);
    expect(items).toHaveLength(3);
    expect(items[1]!.grade).toBe('weak');
    expect(items[1]!.note).toBe('Not assessed.');
    expect(items[2]!.note).toBe('Not assessed.');
  });

  it('ignores out-of-range or unknown-grade lines', () => {
    const items = parseFaithfulnessReply('CLAIM 9: SUPPORTED — x\nCLAIM 1: BANANA — y', batch);
    // Neither line grades a real claim → all fall back to weak/not assessed.
    expect(items.every((i) => i.grade === 'weak')).toBe(true);
  });
});
