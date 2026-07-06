import { describe, expect, it } from 'vitest';
import { dedupeParagraphs } from '../dedupe';

describe('dedupeParagraphs', () => {
  it('collapses an exactly repeated paragraph to a single copy', () => {
    const p =
      'The comparative efficacy of SGLT2 inhibitors and GLP-1 receptor agonists in preventing MACE in adults with type 2 diabetes and chronic kidney disease remains uncertain, with a need for direct comparative trials.';
    const out = dedupeParagraphs([p, p, p, p, p]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(p);
  });

  it('drops a repeat that differs only in citation markers or spacing', () => {
    const a = 'Both drug classes reduced MACE risk in this population [S4], with overlapping effect estimates.';
    const b = 'Both drug classes reduced MACE risk in this population, with overlapping effect estimates.';
    const out = dedupeParagraphs([a, b]);
    expect(out).toHaveLength(1);
  });

  it('keeps genuinely different paragraphs', () => {
    const a =
      'SGLT2 inhibitors reduce intraglomerular pressure and promote natriuresis, which may translate into early hemodynamic benefits in patients with reduced eGFR.';
    const b =
      'GLP-1 receptor agonists enhance glucose-dependent insulin secretion and exert anti-inflammatory effects that may attenuate atherosclerotic progression over time.';
    const out = dedupeParagraphs([a, b]);
    expect(out).toHaveLength(2);
  });

  it('drops a near-duplicate above the threshold but keeps a paraphrase below it', () => {
    const base =
      'The absence of direct head-to-head randomized trials in the chronic kidney disease subgroup forces reliance on indirect network meta-analytic comparisons between the two drug classes.';
    const nearDup =
      'The absence of direct head-to-head randomized trials in the chronic kidney disease subgroup forces reliance on indirect network meta-analytic comparisons across the two drug classes.';
    expect(dedupeParagraphs([base, nearDup])).toHaveLength(1);

    const different =
      'Future pragmatic multicenter trials should enrol patients across the full eGFR spectrum and report both relative and absolute risk reductions for cardiovascular events.';
    expect(dedupeParagraphs([base, different])).toHaveLength(2);
  });

  it('preserves order, first occurrence, and short/blank lines', () => {
    const out = dedupeParagraphs(['First unique line here about trials.', '', 'First unique line here about trials.', 'Short.']);
    expect(out).toEqual(['First unique line here about trials.', '', 'Short.']);
  });
});
