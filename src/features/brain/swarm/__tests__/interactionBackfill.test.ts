import { describe, expect, it } from 'vitest';
import { interactionDrugPair, drugIdentityNote } from '../interactionBackfill';
import { drugCandidates } from '../boss';

const SLCO1B1_KLACID =
  'Write a publication-ready evidence review on whether the SLCO1B1 c.521T>C variant (rs4149056, Val174Ala) ' +
  'predicts simvastatin-induced myopathy, and compare it with ABCG2 Q141K (rs2231142) for statin intolerance. ' +
  'Give per-study effect sizes with confidence intervals, tell me how confident I can be that each association ' +
  'is real, and flag the interaction to watch for in a patient taking simvastatin who is also prescribed Klacid.';

describe('drug parsing does not mistake English words or class stems for drugs', () => {
  it('drops the registry English-word collision "confident" and the bare class word "statin"', () => {
    const candidates = drugCandidates(SLCO1B1_KLACID);
    expect(candidates).not.toContain('confident');
    expect(candidates).not.toContain('each');
    expect(candidates).not.toContain('statin'); // the class, not a specific agent
    expect(candidates).toContain('simvastatin');
    expect(candidates).toContain('klacid');
  });

  it('pairs the real drugs (simvastatin + Klacid), not the noise (statin + confident)', () => {
    expect(interactionDrugPair(SLCO1B1_KLACID)).toEqual(['simvastatin', 'klacid']);
  });

  it('names each brand by its registry generic so the paper cannot invent a drug identity', () => {
    // The real bug: the paper wrote "clindamycin (Klacid)" — Klacid is clarithromycin.
    expect(drugIdentityNote('simvastatin', 'klacid')).toContain('klacid = clarithromycin');
    // A plain generic is not renamed.
    expect(drugIdentityNote('simvastatin', 'atorvastatin')).toBe('');
  });
});

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

  it('reads the pair from the interaction clause, not a coagulation factor named earlier', () => {
    // The real miss: a thrombophilia paper that named "prothrombin G20210A" (a
    // coagulation factor, and a registered drug alias) parsed the pair as
    // "prothrombin + rivaroxaban", so Klacid was never searched — the paper then
    // declared a false no-interaction and invented "clindamycin (Klacid)".
    expect(
      interactionDrugPair(
        'Write a publication-ready evidence review comparing Factor V Leiden (R506Q), ' +
          'prothrombin G20210A, and MTHFR C677T for the risk of recurrent venous thromboembolism. ' +
          'Give a per-variant confidence assessment, and in the same paper address the interaction ' +
          'between rivaroxaban and Klacid for a patient on anticoagulation.',
      ),
    ).toEqual(['rivaroxaban', 'klacid']);
  });
});
