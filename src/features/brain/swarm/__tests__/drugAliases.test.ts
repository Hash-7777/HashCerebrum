import { describe, expect, it } from 'vitest';
import {
  drugSynonyms,
  expandDrugQuery,
  genericsFor,
  isDrugAlias,
  monoIngredient,
  primaryGeneric,
  sameActiveIngredient,
} from '../drugAliases';

describe('drug families and similars', () => {
  it('resolves a single-ingredient brand to its one active ingredient', () => {
    expect(monoIngredient('catafast')).toBe('diclofenac');
    expect(monoIngredient('voltaren')).toBe('diclofenac');
    expect(monoIngredient('xarelto')).toBe('rivaroxaban');
  });

  it('collapses INN/US spelling of the same drug to one ingredient', () => {
    expect(monoIngredient('paracetamol')).toBe(monoIngredient('acetaminophen'));
  });

  it('returns null for a combination / family brand that spans several ingredients', () => {
    expect(monoIngredient('panadol')).toBeNull(); // registry unions paracetamol, caffeine, aspirin…
  });

  it('recognises brand "similars" as the same active ingredient', () => {
    expect(sameActiveIngredient('catafast', 'voltaren')).toBe(true);
    expect(sameActiveIngredient('cataflam', 'diclofenac')).toBe(true);
    expect(sameActiveIngredient('paracetamol', 'acetaminophen')).toBe(true);
  });

  it('does not call different drugs — or a family brand — the same', () => {
    expect(sameActiveIngredient('catafast', 'xarelto')).toBe(false);
    expect(sameActiveIngredient('panadol', 'aspirin')).toBe(false);
  });

  it('primaryGeneric gives a deterministic single search name', () => {
    expect(primaryGeneric('catafast')).toBe('diclofenac');
    expect(primaryGeneric('ibuprofen')).toBe('ibuprofen');
  });
});

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
