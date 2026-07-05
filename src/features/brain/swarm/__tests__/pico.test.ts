import { describe, expect, it } from 'vitest';
import { extractPico, picoSummary, isPicoUseful } from '../pico';

describe('extractPico', () => {
  it('parses a well-formed PICO question', () => {
    const p = extractPico(
      'In adults with atrial fibrillation, does apixaban compared with warfarin reduce the risk of stroke?',
    );
    expect(p.population).toMatch(/adults with atrial fibrillation/i);
    expect(p.intervention).toMatch(/apixaban/i);
    expect(p.comparator).toMatch(/warfarin/i);
    expect(p.outcome).toMatch(/stroke/i);
    expect(isPicoUseful(p)).toBe(true);
  });

  it('handles "efficacy of X versus Y" phrasing', () => {
    const p = extractPico('Efficacy of metformin versus placebo on mortality in type 2 diabetes patients');
    expect(p.intervention).toMatch(/metformin/i);
    expect(p.comparator).toMatch(/placebo/i);
    expect(p.outcome).toMatch(/mortality/i);
  });

  it('returns nulls and an empty summary for a non-clinical question', () => {
    const p = extractPico('What is the capital of France?');
    expect(p).toEqual({ population: null, intervention: null, comparator: null, outcome: null });
    expect(picoSummary(p)).toBe('');
    expect(isPicoUseful(p)).toBe(false);
  });

  it('builds a readable summary from the filled slots', () => {
    const p = extractPico('treatment with statins compared to placebo for cardiovascular events');
    const summary = picoSummary(p);
    expect(summary).toContain('Intervention: statins');
    expect(summary).toContain('Comparator: placebo');
  });
});
