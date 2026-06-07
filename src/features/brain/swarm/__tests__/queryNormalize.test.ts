import { describe, expect, it } from 'vitest';
import { normalizeMedicalSpelling } from '../queryNormalize';

describe('normalizeMedicalSpelling', () => {
  it('fixes the anticouagulant typo that caused the false evidence gap', () => {
    expect(normalizeMedicalSpelling('anticouagulant effect on diabetes elder patients')).toBe(
      'anticoagulant effect on diabetes elder patients',
    );
  });

  it('preserves sentence-leading capitalization', () => {
    expect(normalizeMedicalSpelling('Anticouagulant therapy')).toBe('Anticoagulant therapy');
  });

  it('preserves all-caps tokens', () => {
    expect(normalizeMedicalSpelling('ANTICOUAGULANT')).toBe('ANTICOAGULANT');
  });

  it('keeps surrounding punctuation intact', () => {
    expect(normalizeMedicalSpelling('(anticouagulant),')).toBe('(anticoagulant),');
  });

  it('fixes several common condition and drug misspellings', () => {
    expect(normalizeMedicalSpelling('diabetis and hypertention')).toBe('diabetes and hypertension');
    expect(normalizeMedicalSpelling('metaformin with ibuprofin')).toBe('metformin with ibuprofen');
  });

  it('corrects a single-character typo via the fuzzy lexicon pass', () => {
    // distance-1 deletion of an l → corrected to the canonical term
    expect(normalizeMedicalSpelling('anticoagulnt')).toBe('anticoagulant');
  });

  it('never alters correctly-spelled subject terms', () => {
    const q = 'anticoagulant effect on diabetes in elderly patients with atrial fibrillation';
    expect(normalizeMedicalSpelling(q)).toBe(q);
  });

  it('does not touch short common words', () => {
    const q = 'does the drug work for older men and women over time';
    expect(normalizeMedicalSpelling(q)).toBe(q);
  });

  it('preserves whitespace shape', () => {
    expect(normalizeMedicalSpelling('  diabetis   patients ')).toBe('  diabetes   patients ');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeMedicalSpelling('')).toBe('');
  });
});
