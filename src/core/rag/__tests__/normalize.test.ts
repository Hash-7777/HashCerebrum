import { describe, expect, it } from 'vitest';
import { expandQuery } from '../search/normalize';

describe('expandQuery', () => {
  it('expands a drug brand name to its generic (and siblings)', () => {
    const out = expandQuery('is Tylenol safe in pregnancy').toLowerCase();
    expect(out).toContain('acetaminophen');
    expect(out).toContain('paracetamol');
  });

  it('expands a clinical abbreviation to its full form', () => {
    const out = expandQuery('MI risk after surgery').toLowerCase();
    expect(out).toContain('myocardial infarction');
    expect(out).toContain('heart attack');
  });

  it('is bidirectional — a generic query gains the brand/abbreviation', () => {
    const out = expandQuery('clopidogrel interactions').toLowerCase();
    expect(out).toContain('plavix');
  });

  it('leaves an unrecognised query unchanged', () => {
    expect(expandQuery('koala feeding behaviour')).toBe('koala feeding behaviour');
  });

  it('does not duplicate a term already present', () => {
    const out = expandQuery('acetaminophen vs paracetamol');
    // 'tylenol' and 'panadol' get appended once; existing terms are not repeated.
    expect(out.match(/acetaminophen/g)?.length).toBe(1);
    expect(out.toLowerCase()).toContain('tylenol');
  });
});
