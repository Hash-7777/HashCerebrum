import { describe, expect, it } from 'vitest';
import { interactionDrugPair } from '../interactionBackfill';

describe('interactionDrugPair', () => {
  it('detects an interaction sub-request embedded in a paper query', () => {
    // The real miss: the interaction rode along with a comparative paper request
    // and was dropped, so the paper reported "no interaction data".
    expect(
      interactionDrugPair(
        'compare MTHFR and F5 for recurrent VTE and note the rivaroxaban and catafast interaction',
      ),
    ).toEqual(['rivaroxaban', 'catafast']);
  });

  it('detects a plain two-drug interaction question', () => {
    expect(interactionDrugPair('is there an interaction between warfarin and ibuprofen')).toEqual([
      'warfarin',
      'ibuprofen',
    ]);
  });

  it('does not fire on a comparison with no interaction cue', () => {
    // A comparative paper about two drugs is NOT an interaction request.
    expect(interactionDrugPair('compare aspirin and warfarin outcomes for stroke prevention')).toBeNull();
  });

  it('does not fire without two recognized drugs', () => {
    expect(interactionDrugPair('does this drug interact with anything at all')).toBeNull();
  });

  it('does not mistake the connector "also" for a drug', () => {
    // The real bug: "…and also note the interaction between rivaroxaban and
    // catafast" parsed "also" as a drug, dropping catafast from the pair.
    expect(
      interactionDrugPair('and also note the interaction between rivaroxaban and catafast for these patients'),
    ).toEqual(['rivaroxaban', 'catafast']);
  });
});
