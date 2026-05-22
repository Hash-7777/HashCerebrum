import { describe, expect, it } from 'vitest';
import { curb65, qsofa, sofa, chadsVasc, hasBled, wells, meld, computeRiskScores } from '../riskScores';

describe('CURB-65', () => {
  it('scores a low-risk patient', () => {
    const r = curb65({ age: '45', respiratory_rate: '18', sbp: '120', bun: '12' });
    expect(r).not.toBeNull();
    expect(r!.score).toBe(0);
    expect(r!.category).toBe('Low risk');
  });

  it('scores a high-risk patient', () => {
    const r = curb65({ age: '75', confusion: 'yes', respiratory_rate: '32', sbp: '85', bun: '25' });
    expect(r).not.toBeNull();
    expect(r!.score).toBe(5);
    expect(r!.category).toBe('High risk');
  });

  it('returns null when no applicable columns', () => {
    expect(curb65({ height: '170', weight: '70' })).toBeNull();
  });
});

describe('qSOFA', () => {
  it('flags high-risk sepsis', () => {
    const r = qsofa({ respiratory_rate: '24', sbp: '90', altered_mentation: 'yes' });
    expect(r).not.toBeNull();
    expect(r!.score).toBe(3);
    expect(r!.category).toContain('High risk');
  });
});

describe('SOFA', () => {
  it('computes organ dysfunction', () => {
    const r = sofa({ platelets: '80', bilirubin: '3.0', map: '60', gcs: '10', creatinine: '2.5' });
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThan(0);
  });
});

describe('CHA₂DS₂-VASc', () => {
  it('scores an AF patient', () => {
    const r = chadsVasc({ age: '72', htn: 'yes', dm: 'yes', sex: 'female' });
    expect(r).not.toBeNull();
    expect(r!.score).toBe(4);
  });
});

describe('HAS-BLED', () => {
  it('scores bleeding risk', () => {
    const r = hasBled({ htn: 'yes', age: '70', alcohol: 'yes' });
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThanOrEqual(2);
  });
});

describe('Wells', () => {
  it('assesses PE probability', () => {
    const r = wells({ heart_rate: '110', cancer: 'yes', prior_pe: 'yes', dvt_symptoms: 'yes' });
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThanOrEqual(3);
  });
});

describe('MELD', () => {
  it('computes liver severity', () => {
    const r = meld({ bilirubin: '3.5', inr: '1.8', creatinine: '1.5' });
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThanOrEqual(6);
    expect(r!.score).toBeLessThanOrEqual(40);
  });

  it('returns null when required labs missing', () => {
    expect(meld({ bilirubin: '2.0' })).toBeNull();
  });
});

describe('computeRiskScores dispatcher', () => {
  it('returns applicable scores for a mixed record', () => {
    const record = {
      age: '68',
      sbp: '95',
      respiratory_rate: '28',
      bun: '22',
      htn: 'yes',
      dm: 'yes',
    };
    const scores = computeRiskScores(record);
    expect(scores.length).toBeGreaterThanOrEqual(2);
    const ids = scores.map((s) => (s as unknown as { scoreId: string }).scoreId);
    expect(ids).toContain('curb65');
    expect(ids).toContain('chads_vasc');
  });
});
