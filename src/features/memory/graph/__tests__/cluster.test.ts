import { describe, expect, it } from 'vitest';
import { chooseK, clusterLabel, distinctiveClusterLabels, kmeans } from '../cluster';

// Build a unit vector that lives near one of three orthogonal directions, with
// a little deterministic jitter, so the three groups are genuinely separable.
function near(axis: 0 | 1 | 2, jitter: number): Float32Array {
  const v = new Float32Array(8);
  v[axis] = 1;
  v[(axis + 1) % 8] = jitter;
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] = v[i]! / norm;
  return v;
}

describe('kmeans clustering', () => {
  it('recovers three well-separated groups', () => {
    const vectors = [
      near(0, 0.02), near(0, 0.05), near(0, 0.01),
      near(1, 0.03), near(1, 0.04), near(1, 0.02),
      near(2, 0.01), near(2, 0.05), near(2, 0.03),
    ];
    const { assignments, k } = kmeans(vectors, 3, 7);
    expect(k).toBe(3);
    // Each true group must land in a single cluster.
    expect(new Set(assignments.slice(0, 3)).size).toBe(1);
    expect(new Set(assignments.slice(3, 6)).size).toBe(1);
    expect(new Set(assignments.slice(6, 9)).size).toBe(1);
    // The three groups must be distinct clusters.
    expect(new Set([assignments[0], assignments[3], assignments[6]]).size).toBe(3);
  });

  it('is deterministic for the same seed and data', () => {
    const vectors = [near(0, 0.02), near(1, 0.03), near(2, 0.01), near(0, 0.04)];
    expect(kmeans(vectors, 3, 11).assignments).toEqual(kmeans(vectors, 3, 11).assignments);
  });

  it('drops empty clusters and reports real sizes', () => {
    const vectors = [near(0, 0.01), near(0, 0.02)];
    const res = kmeans(vectors, 5, 1); // ask for more clusters than points
    expect(res.k).toBeLessThanOrEqual(2);
    expect(res.sizes.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('chooseK scales with size and stays in range', () => {
    expect(chooseK(2)).toBe(2);
    expect(chooseK(8)).toBe(2);
    expect(chooseK(800)).toBe(10);
    expect(chooseK(50)).toBeGreaterThanOrEqual(2);
    expect(chooseK(50)).toBeLessThanOrEqual(10);
  });

  it('gives two same-topic clusters distinct labels via distinctive terms', () => {
    const labels = distinctiveClusterLabels([
      // both clusters share "warfarin"/"nsaids" but differ on bleeding vs kinetics
      ['warfarin nsaids bleeding hemorrhage', 'warfarin nsaids bleeding risk'],
      ['warfarin nsaids pharmacokinetics clearance', 'warfarin nsaids metabolism kinetics'],
    ]);
    expect(labels[0]).not.toBe(labels[1]); // no "Digoxin · Nsaids" twice
    expect(`${labels[0]} ${labels[1]}`.toLowerCase()).toMatch(/bleeding|hemorrhage/);
    expect(`${labels[0]} ${labels[1]}`.toLowerCase()).toMatch(/pharmacokinetics|kinetics|metabolism|clearance/);
  });

  it('never returns identical labels even when clusters are indistinguishable', () => {
    const labels = distinctiveClusterLabels([
      ['warfarin nsaids', 'warfarin nsaids'],
      ['warfarin nsaids', 'warfarin nsaids'],
    ]);
    expect(new Set(labels).size).toBe(2);
  });

  it('labels a cluster by its most frequent meaningful terms', () => {
    const label = clusterLabel([
      'warfarin bleeding risk in NSAIDs',
      'warfarin and NSAIDs interaction',
      'warfarin dosing pediatric',
    ]);
    expect(label.toLowerCase()).toContain('warfarin');
    // Stopwords / meta terms must not be chosen.
    expect(label.toLowerCase()).not.toContain('risk');
  });

  it('does not let a single-finding fluke token name a cluster', () => {
    // 'sundae' / 'origami' appear once; 'warfarin' recurs and should win. The
    // filter is frequency-based, never a denylist of specific words.
    const label = clusterLabel([
      'warfarin elderly anticoagulation sundae',
      'warfarin atrial fibrillation origami',
      'warfarin bleeding elderly',
      'warfarin dosing elderly',
    ]);
    expect(label.toLowerCase()).not.toContain('sundae');
    expect(label.toLowerCase()).not.toContain('origami');
    expect(label.toLowerCase()).toContain('warfarin');
  });

  it('keeps a real recurring gene symbol (e.g. MICA) as a label', () => {
    // A genuine research cluster — like the MICA gene work — recurs across its
    // findings and MUST survive as a label. The recurrence filter only drops
    // one-off tokens; it never suppresses a real recurring term.
    const label = clusterLabel([
      'MICA gene polymorphism in transplant rejection',
      'MICA allele association with autoimmune disease',
      'soluble MICA and NKG2D ligand in cancer',
      'MICA expression and NK cell activation',
    ]);
    expect(label.toLowerCase()).toContain('mica');
  });

  it('drops generic connective words like "among" and "analyze"', () => {
    const label = clusterLabel([
      'among elderly patients we analyze digoxin levels',
      'analyze digoxin among older adults',
      'digoxin toxicity in elderly',
      'digoxin clearance elderly',
    ]);
    expect(label.toLowerCase()).not.toContain('among');
    expect(label.toLowerCase()).not.toContain('analyze');
    expect(label.toLowerCase()).toContain('digoxin');
  });

  it('drops request/instruction words that leak from saved query text', () => {
    // From real runs: labels like "Sglt2 · Already", "Already · Building",
    // "Amitriptyline · Dose · Exact" — the request words must not become labels.
    const label = clusterLabel([
      'Building on the SGLT2 inhibitor evidence already in memory',
      'evaluate dapagliflozin already in memory and reuse prior findings',
      'SGLT2 inhibitor dapagliflozin renal outcomes',
      'SGLT2 inhibitor cardiovascular outcomes',
    ]);
    const lower = label.toLowerCase();
    for (const junk of ['already', 'building', 'memory', 'reuse', 'evaluate', 'prior']) {
      expect(lower).not.toContain(junk);
    }
    expect(lower).toContain('sglt2');

    const dose = clusterLabel([
      'exact lethal overdose dose of amitriptyline',
      'amitriptyline exact dose to overdose',
      'amitriptyline toxicity case series',
      'amitriptyline cardiotoxicity management',
    ]);
    expect(dose.toLowerCase()).toContain('amitriptyline');
    for (const junk of ['exact', 'dose', 'lethal', 'overdose']) {
      expect(dose.toLowerCase()).not.toContain(junk);
    }
  });
});
