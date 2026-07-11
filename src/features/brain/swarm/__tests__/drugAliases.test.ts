import { describe, expect, it } from 'vitest';
import { drugSynonyms, expandDrugQuery, genericsFor, isDrugAlias } from '../drugAliases';

describe('drugAliases', () => {
  it('resolves Egyptian brands to their active ingredient from the dataset', () => {
    expect(genericsFor('catafast')).toContain('diclofenac');
    expect(genericsFor('panadol')).toContain('paracetamol');
    expect(genericsFor('augmentin')).toEqual(expect.arrayContaining(['amoxicillin', 'clavulanic']));
    expect(genericsFor('glucophage')).toContain('metformin');
  });

  it('resolves generic↔generic INN/US synonyms', () => {
    expect(genericsFor('paracetamol')).toContain('acetaminophen');
    expect(genericsFor('salbutamol')).toContain('albuterol');
  });

  it('recognises known brands and generics, rejects ordinary words', () => {
    expect(isDrugAlias('catafast')).toBe(true);
    expect(isDrugAlias('panadol')).toBe(true);
    expect(isDrugAlias('interaction')).toBe(false);
    expect(isDrugAlias('between')).toBe(false);
  });

  it('drugSynonyms includes the token itself plus its generics (for evidence checks)', () => {
    const syn = drugSynonyms('catafast');
    expect(syn).toContain('catafast');
    expect(syn).toContain('diclofenac');
  });

  it('expandDrugQuery appends generic names so brand queries retrieve real evidence', () => {
    const expanded = expandDrugQuery('interaction between panadol and catafast');
    expect(expanded).toContain('diclofenac');
    expect(expanded.toLowerCase()).toMatch(/paracetamol|acetaminophen/);
  });

  it('leaves a query with no known brand unchanged', () => {
    const q = 'interaction between warfarin and amiodarone';
    // warfarin/amiodarone are already generic names present in the text.
    expect(expandDrugQuery(q)).toBe(q);
  });
});
