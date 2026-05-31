import { describe, expect, it } from 'vitest';
import { stripLeakedSpecialistLabels } from '../boss';

describe('stripLeakedSpecialistLabels', () => {
  it('removes leaked internal specialist-label pseudo-citations', () => {
    const cleaned = stripLeakedSpecialistLabels(
      'SGLT-2 inhibitors are disease-modifying in HFrEF [S18] [Specialist Findings - Clinical trials]. ' +
        'They share a class effect [Specialist Findings - Pharmacology].',
    );
    expect(cleaned).not.toMatch(/specialist findings/i);
    // Real [S#] citations and the prose are preserved; punctuation stays tidy.
    expect(cleaned).toContain('[S18]');
    expect(cleaned).toContain('disease-modifying in HFrEF [S18].');
    expect(cleaned).not.toContain('  ');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Empagliflozin reduced HF hospitalization [S3] (HR 0.75).';
    expect(stripLeakedSpecialistLabels(text)).toBe(text);
  });
});
