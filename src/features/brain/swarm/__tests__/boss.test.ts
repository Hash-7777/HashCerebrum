import { describe, expect, it } from 'vitest';
import {
  ensureInteractionDisclaimer,
  isConfidentInteractionReport,
  stripLeakedSpecialistLabels,
} from '../boss';

describe('ensureInteractionDisclaimer', () => {
  it('appends the safety footer when the report has no verify-clinician line', () => {
    const out = ensureInteractionDisclaimer('**A ↔ B**\n**Grade: C — Moderate**');
    expect(out.toLowerCase()).toContain('verify every result');
    expect(out.toLowerCase()).toContain('pharmacist or physician');
  });

  it('does not duplicate when the model already closed with a verify-clinician line', () => {
    const withLine =
      '**A ↔ B**\n**Grade: C**\n\n*Informational triage only — verify with a licensed pharmacist or physician before any medication decision.*';
    const out = ensureInteractionDisclaimer(withLine);
    expect(out).toBe(withLine.trimEnd());
    expect(out.toLowerCase().match(/verify/g)?.length).toBe(1);
  });
});

describe('isConfidentInteractionReport', () => {
  it('keeps a clear verdict (including a confident "no interaction")', () => {
    expect(isConfidentInteractionReport('**Verdict:** Established interaction — CYP3A4 inhibition [S1].')).toBe(true);
    expect(
      isConfidentInteractionReport('**Verdict:** No clinically significant interaction is expected [S2].'),
    ).toBe(true);
  });

  it('rejects an unsure report so the shared memory is fed only sure answers', () => {
    expect(isConfidentInteractionReport('**Verdict:** Insufficient evidence to assess this combination.')).toBe(false);
    expect(isConfidentInteractionReport('The interaction could not be established from the retrieved records.')).toBe(false);
    expect(isConfidentInteractionReport('')).toBe(false);
  });
});

describe('stripLeakedSpecialistLabels', () => {
  it('removes leaked internal specialist-label pseudo-citations', () => {
    const cleaned = stripLeakedSpecialistLabels(
      'SGLT-2 inhibitors are disease-modifying in HFrEF [S18] [Specialist Findings - Clinical trials]. ' +
        'They share a class effect [Specialist Findings - Pharmacology].',
    );
    expect(cleaned).not.toMatch(/specialist findings/i);
    // Real [S#] citations and the prose are preserved; punctuation stays tidy.
    expect(cleaned).toContain('[S18]');
    expect(cleaned).toContain('disease-modifying in HFrEF [S18].');
    expect(cleaned).not.toContain('  ');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'Empagliflozin reduced HF hospitalization [S3] (HR 0.75).';
    expect(stripLeakedSpecialistLabels(text)).toBe(text);
  });
});
