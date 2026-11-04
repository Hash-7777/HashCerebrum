import { describe, expect, it } from 'vitest';
import { mergeTasksPerSpecialist, pruneIrrelevantPharmacist, type BossPlan } from '../boss';
import { agentById } from '@config/agents';

const plan = (...tasks: Array<[BossPlan['tasks'][number]['agentId'], string]>): BossPlan => ({
  mode: 'research',
  tasks: tasks.map(([agentId, subQuery]) => ({ agentId, subQuery })),
});

describe('pruneIrrelevantPharmacist', () => {
  it('drops the Pharmacist from a question with no medicine in it', () => {
    const out = pruneIrrelevantPharmacist(
      plan(['clinical_research', 'trial outcomes'], ['pharmacist', 'dosing']),
      'How common is long COVID fatigue after mild infection in adults?',
    );
    expect(out.tasks.map((t) => t.agentId)).toEqual(['clinical_research']);
  });

  it('keeps it for a named drug or a drug question', () => {
    const p = plan(['clinical_research', 'trials'], ['pharmacist', 'safety']);
    expect(pruneIrrelevantPharmacist(p, 'Is rosuvastatin effective for long COVID fatigue?').tasks).toHaveLength(2);
    expect(pruneIrrelevantPharmacist(p, 'What does evidence say about SGLT2 inhibitors in HFpEF?').tasks).toHaveLength(2);
    expect(pruneIrrelevantPharmacist(p, 'What treatments reduce migraine frequency?').tasks).toHaveLength(2);
  });

  it('never leaves an empty plan', () => {
    const out = pruneIrrelevantPharmacist(plan(['pharmacist', 'x']), 'How is sleep apnoea diagnosed?');
    expect(out.tasks).toEqual([{ agentId: 'evidence_synthesis', subQuery: 'How is sleep apnoea diagnosed?' }]);
  });
});

describe('mergeTasksPerSpecialist', () => {
  it('runs each specialist once, carrying all of its sub-questions', () => {
    const out = mergeTasksPerSpecialist(
      plan(['evidence_synthesis', 'reviews'], ['clinical_research', 'trials'], ['evidence_synthesis', 'guidelines']),
    );
    expect(out.tasks).toEqual([
      { agentId: 'evidence_synthesis', subQuery: 'reviews Also: guidelines' },
      { agentId: 'clinical_research', subQuery: 'trials' },
    ]);
  });

  it('leaves a plan with distinct specialists unchanged', () => {
    const p = plan(['evidence_synthesis', 'a'], ['genetics', 'b']);
    expect(mergeTasksPerSpecialist(p)).toEqual(p);
  });
});

describe('specialist tools', () => {
  it('leaves the drug-label and drug-name sources to the Pharmacist', () => {
    for (const id of ['clinical_research', 'evidence_synthesis'] as const) {
      expect(agentById(id).tools).not.toContain('openfda_query');
      expect(agentById(id).tools).not.toContain('rxnorm_lookup');
      expect(agentById(id).tools).toContain('pubmed_search');
    }
    expect(agentById('pharmacist').tools).toContain('openfda_query');
  });
});
