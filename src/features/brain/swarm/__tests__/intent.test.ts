import { describe, expect, it } from 'vitest';
import { classifyIntentHeuristic, resolveIntent } from '../intent';

describe('classifyIntentHeuristic', () => {
  it('routes an explicit paper request to paper — even with a gene in it', () => {
    expect(classifyIntentHeuristic('Write a full research paper on BRCA1 and breast cancer').intent).toBe('paper');
    expect(classifyIntentHeuristic('Draft a systematic review of DOACs versus warfarin').intent).toBe('paper');
  });

  it('routes a drug-interaction question to drug_interactions', () => {
    expect(classifyIntentHeuristic('Grade the interactions between warfarin, amiodarone and aspirin').intent).toBe(
      'drug_interactions',
    );
    expect(classifyIntentHeuristic('Can I take ibuprofen together with warfarin?').intent).toBe('drug_interactions');
  });

  it('does not fire drug_interactions without two drugs', () => {
    expect(classifyIntentHeuristic('what are common drug interactions to watch for').intent).not.toBe(
      'drug_interactions',
    );
  });

  it('routes a gene × disease question to genetics', () => {
    expect(
      classifyIntentHeuristic('Association between the MICA TT genotype and cardiovascular complications in type 1 diabetes').intent,
    ).toBe('genetics');
    expect(classifyIntentHeuristic('Does APOE variant affect Alzheimer risk?').intent).toBe('genetics');
  });

  it('routes a memory recall to rag', () => {
    expect(classifyIntentHeuristic('What do I know about metformin from my library?').intent).toBe('rag');
  });

  it('routes a short factual question to lookup', () => {
    expect(classifyIntentHeuristic('What is the half-life of apixaban?').intent).toBe('lookup');
  });

  it('defaults a clinical synthesis question to evidence_review', () => {
    const r = classifyIntentHeuristic('efficacy and bleeding risk of anticoagulants in elderly patients with kidney disease');
    expect(r.intent).toBe('evidence_review');
    expect(r.ambiguous).toBe(false);
  });

  it('flags a 1-2 word input as ambiguous', () => {
    expect(classifyIntentHeuristic('metformin').ambiguous).toBe(true);
  });
});

describe('resolveIntent', () => {
  it('a forced intent overrides the heuristic', () => {
    const r = resolveIntent('warfarin and aspirin', { forcedIntent: 'paper' });
    expect(r.intent).toBe('paper');
    expect(r.forced).toBe(true);
  });

  it('applies a forced effort modifier', () => {
    expect(resolveIntent('DOACs vs warfarin', { forcedEffort: 'mini' }).effort).toBe('mini');
    expect(resolveIntent('DOACs vs warfarin').effort).toBe('standard');
  });
});
