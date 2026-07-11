import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from '@platform/index';
import { harvestTrialNames } from '../trialBackfill';

const rec = (title: string, snippet = ''): EvidenceItem => ({
  title,
  authors: [],
  identifiers: {},
  fetchedAt: '',
  provenanceHash: 'h',
  source: 'pubmed',
  snippet,
});

describe('harvestTrialNames', () => {
  it('pulls the trial acronyms a meta-analysis cites', () => {
    const names = harvestTrialNames([
      rec(
        'SGLT2 inhibitors: a meta-analysis of cardiovascular outcome trials',
        'We pooled the randomized trials EMPA-REG OUTCOME, CANVAS, DECLARE-TIMI 58, and VERTIS CV to estimate MACE.',
      ),
    ]);
    expect(names).toContain('EMPA-REG OUTCOME');
    expect(names).toContain('CANVAS');
    expect(names).toContain('DECLARE-TIMI 58');
    expect(names).toContain('VERTIS CV');
  });

  it('does not mistake drug classes, endpoints, stats or orgs for trials', () => {
    const names = harvestTrialNames([
      rec(
        'GLP-1 receptor agonists and SGLT2 inhibitors in T2DM',
        'Across these studies, MACE and HHF fell; the ESC and ADA endorse both classes (HR and RR reported with 95% CI).',
      ),
    ]);
    for (const junk of ['SGLT2', 'GLP', 'MACE', 'HHF', 'ESC', 'ADA', 'HR', 'RR', 'CI', 'T2DM']) {
      expect(names).not.toContain(junk);
    }
  });

  it('captures a strong hyphenated trial shape even without a context word', () => {
    const names = harvestTrialNames([rec('Empagliflozin outcomes', 'Reported in DAPA-HF and EMPEROR-Reduced.')]);
    expect(names).toContain('DAPA-HF');
  });

  it('ranks the most-cited trial first', () => {
    const names = harvestTrialNames([
      rec('Review one', 'The LEADER trial and SUSTAIN-6 trial were included.'),
      rec('Review two', 'LEADER trial again reported cardiovascular benefit.'),
    ]);
    expect(names[0]).toBe('LEADER');
  });

  it('returns nothing when no trial names are present', () => {
    expect(harvestTrialNames([rec('A narrative overview of diabetes care', 'No trials are named here.')])).toEqual([]);
  });

  it('does not mistake drug-class acronyms for trials but keeps the real trial names', () => {
    const names = harvestTrialNames([
      rec('GLP-1 RA meta-analysis', 'We pooled the LEADER trial and SUSTAIN-6 trial; GLP-1RA, SGLT-2, and DPP-4 classes were compared.'),
    ]);
    expect(names).toContain('LEADER');
    expect(names).toContain('SUSTAIN-6');
    for (const junk of ['GLP-1RA', 'GLP1RA', 'SGLT-2', 'SGLT2', 'DPP-4', 'DPP4', 'GLP-1']) {
      expect(names).not.toContain(junk);
    }
  });

  it('does not treat gene symbols or genetic variants as trials', () => {
    const names = harvestTrialNames([
      rec('MTHFR thrombophilia study', 'The MTHFR C677T and A1298C and G20210A variants were studied in a cohort.'),
    ]);
    for (const junk of ['MTHFR', 'C677T', 'A1298C', 'G20210A']) {
      expect(names).not.toContain(junk);
    }
  });
});
