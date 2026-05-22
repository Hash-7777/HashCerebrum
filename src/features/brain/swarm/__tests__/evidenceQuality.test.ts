import { describe, expect, it } from 'vitest';
import {
  gradeDowngrade,
  rob2Overall,
  robinsIOverall,
  quadas2Overall,
  nntFromRiskDifference,
  ROB2_DOMAINS,
  ROBINSI_DOMAINS,
} from '../evidenceQuality';

describe('GRADE downgrade', () => {
  it('keeps high when no domains downgrade', () => {
    const result = gradeDowngrade('high', []);
    expect(result.final).toBe('high');
  });

  it('downgrades one step for serious concern', () => {
    const result = gradeDowngrade('high', [
      { name: 'Risk of bias', downgrade: true, seriousness: 'serious' },
    ]);
    expect(result.final).toBe('moderate');
  });

  it('downgrades two steps for very serious concern', () => {
    const result = gradeDowngrade('high', [
      { name: 'Imprecision', downgrade: true, seriousness: 'very_serious' },
    ]);
    expect(result.final).toBe('low');
  });

  it('caps at very_low', () => {
    const result = gradeDowngrade('low', [
      { name: 'Risk of bias', downgrade: true, seriousness: 'very_serious' },
      { name: 'Imprecision', downgrade: true, seriousness: 'very_serious' },
    ]);
    expect(result.final).toBe('very_low');
  });
});

describe('RoB 2 overall', () => {
  it('is low when all domains are low', () => {
    const result = rob2Overall([
      { domain: ROB2_DOMAINS[0]!, judgement: 'low', support: '...' },
      { domain: ROB2_DOMAINS[1]!, judgement: 'low', support: '...' },
    ]);
    expect(result).toBe('low');
  });

  it('is high if any domain is high', () => {
    const result = rob2Overall([
      { domain: ROB2_DOMAINS[0]!, judgement: 'low', support: '...' },
      { domain: ROB2_DOMAINS[1]!, judgement: 'high', support: '...' },
    ]);
    expect(result).toBe('high');
  });
});

describe('ROBINS-I overall', () => {
  it('is critical if any domain is critical', () => {
    const result = robinsIOverall([
      { domain: ROBINSI_DOMAINS[0]!, judgement: 'serious', support: '...' },
      { domain: ROBINSI_DOMAINS[1]!, judgement: 'critical', support: '...' },
    ]);
    expect(result).toBe('critical');
  });
});

describe('QUADAS-2 overall', () => {
  it('is high if any domain is high', () => {
    const result = quadas2Overall({
      studyId: 's1',
      title: 'Test',
      patientSelection: { domain: 'PS', judgement: 'low', support: '...' },
      indexTest: { domain: 'IT', judgement: 'high', support: '...' },
      referenceStandard: { domain: 'RS', judgement: 'low', support: '...' },
      flowTiming: { domain: 'FT', judgement: 'low', support: '...' },
    });
    expect(result).toBe('high');
  });
});

describe('NNT / NNH', () => {
  it('computes NNT from positive risk difference', () => {
    expect(nntFromRiskDifference(0.1)).toBeCloseTo(10, 1);
  });

  it('returns null for zero risk difference', () => {
    expect(nntFromRiskDifference(0)).toBeNull();
  });
});
