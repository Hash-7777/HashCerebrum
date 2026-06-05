import { describe, expect, it } from 'vitest';
import {
  buildInteractionMatrix,
  interactionMatrixFromReport,
  interactionMatrixMarkdown,
  parseInteractionPairs,
} from '../interactionMatrix';

const report = `Here is the assessment.

---
**Warfarin ↔ Aspirin**
**Grade: D — Major**
- **Mechanism:** additive antihaemostatic effect [S1]
- **Effect:** increased bleeding risk [S2]
- **Action:** avoid or monitor INR closely [S3]
- **Evidence:** label-level and cohort data

---
**Warfarin ↔ Omeprazole**
**Grade: C — Moderate**
- **Mechanism:** CYP2C19 inhibition raises warfarin exposure [S4]
- **Effect:** elevated INR [S5]
- **Action:** monitor INR [S6]
- **Evidence:** literature

---
**Aspirin ↔ Omeprazole**
**Grade: B — Minor**
- **Mechanism:** reduced gastroprotection [S7]
- **Effect:** minor [S8]
- **Action:** monitor symptoms [S9]
- **Evidence:** theoretical

**⚠️ Critical alerts** — **Warfarin** + **Aspirin** major bleeding risk.
**Confidence:** sources support the grades.
*Informational triage only — verify with a licensed pharmacist or physician before any medication decision.*`;

describe('parseInteractionPairs', () => {
  it('extracts every graded pair', () => {
    const pairs = parseInteractionPairs(report);
    expect(pairs).toHaveLength(3);
    expect(pairs).toContainEqual({ drugA: 'Warfarin', drugB: 'Aspirin', grade: 'D' });
    expect(pairs).toContainEqual({ drugA: 'Warfarin', drugB: 'Omeprazole', grade: 'C' });
    expect(pairs).toContainEqual({ drugA: 'Aspirin', drugB: 'Omeprazole', grade: 'B' });
  });

  it('returns nothing for prose without graded cards', () => {
    expect(parseInteractionPairs('No interactions were assessed in this answer.')).toEqual([]);
  });

  it('de-duplicates a repeated pair, keeping the last grade', () => {
    const dup = `**A ↔ B**\n**Grade: B — Minor**\n\n**B ↔ A**\n**Grade: X — Contraindicated**`;
    const pairs = parseInteractionPairs(dup);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.grade).toBe('X');
  });

  it('ignores a self-pair and an invalid grade letter', () => {
    const bad = `**Aspirin ↔ Aspirin**\n**Grade: A — None**\n\n**Foo ↔ Bar**\n**Grade: Z — ??**`;
    expect(parseInteractionPairs(bad)).toEqual([]);
  });
});

describe('buildInteractionMatrix', () => {
  it('builds a symmetric square grid for 3+ drugs', () => {
    const matrix = buildInteractionMatrix(parseInteractionPairs(report));
    expect(matrix).not.toBeNull();
    expect(matrix!.drugs).toEqual(['Warfarin', 'Aspirin', 'Omeprazole']);
    // diagonal is null
    expect(matrix!.cells[0]![0]).toBeNull();
    // symmetric off-diagonal
    expect(matrix!.cells[0]![1]).toBe('D');
    expect(matrix!.cells[1]![0]).toBe('D');
    expect(matrix!.cells[0]![2]).toBe('C');
    expect(matrix!.cells[1]![2]).toBe('B');
  });

  it('returns null with fewer than three distinct drugs', () => {
    const twoDrug = `**Warfarin ↔ Aspirin**\n**Grade: D — Major**`;
    expect(buildInteractionMatrix(parseInteractionPairs(twoDrug))).toBeNull();
  });

  it('leaves an ungraded pair as a null cell', () => {
    const partial = `**A ↔ B**\n**Grade: C — Moderate**\n\n**B ↔ C**\n**Grade: D — Major**`;
    const matrix = interactionMatrixFromReport(partial);
    expect(matrix).not.toBeNull();
    // A × C was never graded
    const a = matrix!.drugs.indexOf('A');
    const c = matrix!.drugs.indexOf('C');
    expect(matrix!.cells[a]![c]).toBeNull();
  });
});

describe('interactionMatrixMarkdown', () => {
  it('renders a numbered Markdown table of the grades for exports', () => {
    const matrix = buildInteractionMatrix(parseInteractionPairs(report))!;
    const md = interactionMatrixMarkdown(matrix);
    expect(md).toContain('### Interaction overview');
    expect(md).toContain('| Drug | 1 | 2 | 3 |');
    expect(md).toContain('| 1. Warfarin | — | D | C |');
    expect(md).toContain('| 2. Aspirin | D | — | B |');
  });
});
