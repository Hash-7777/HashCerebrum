import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceItem } from '@platform/index';
import type { Manuscript } from '../manuscript';
import { buildPublicationArtifact } from '../publication';
import { datasetSummaryForPrompt, summarizeDatasetText } from '../statistics';

describe('dataset statistics summary', () => {
  it('computes deterministic descriptive summaries for CSV input', async () => {
    const summary = await summarizeDatasetText(
      'warfarin.csv',
      [
        'group,age,bleed',
        'warfarin,72,yes',
        'warfarin,68,no',
        'control,64,no',
        'control,,yes',
      ].join('\n'),
    );

    expect(summary.filename).toBe('warfarin.csv');
    expect(summary.rows).toBe(4);
    expect(summary.columns).toEqual(['group', 'age', 'bleed']);
    expect(summary.columnSummaries.find((column) => column.name === 'age')).toMatchObject({
      type: 'numeric',
      nonMissing: 3,
      missing: 1,
      median: 68,
    });
    expect(summary.columnSummaries.find((column) => column.name === 'group')?.levels?.[0]).toEqual({
      value: 'control',
      count: 2,
    });
    expect(datasetSummaryForPrompt(summary)).toContain('Computed descriptive statistics:');
  });

  it('attaches a computed inferential analysis plan to the dataset summary', async () => {
    const rows = ['arm,outcome'];
    for (let i = 0; i < 10; i += 1) rows.push('treated,event', 'control,none');
    const summary = await summarizeDatasetText('trial.csv', rows.join('\n'));

    expect(summary.inferential).toBeDefined();
    expect(summary.inferential!.generated).toBe(true);
    expect(summary.inferential!.analyses.some((a) => a.kind === 'two_by_two')).toBe(true);
    expect(datasetSummaryForPrompt(summary)).toContain('Computed inferential statistics');
  });

  it('supports original-research manuscript statistics from the sample clinical dataset', async () => {
    const csv = readFileSync(join(process.cwd(), 'docs/sample-clinical-dataset.csv'), 'utf8');
    const summary = await summarizeDatasetText('sample-clinical-dataset.csv', csv);

    expect(summary.rows).toBe(48);
    expect(summary.inferential?.generated).toBe(true);

    const twoByTwo = summary.inferential?.analyses.find((analysis) => analysis.kind === 'two_by_two');
    expect(twoByTwo?.estimate?.label).toBe('Odds ratio');
    expect(twoByTwo?.reportText).toMatch(/odds ratio.*95% CI .*p =/i);
    expect(Number.isFinite(twoByTwo?.pValue ?? Number.NaN)).toBe(true);

    expect(summary.inferential?.subgroups?.rows.length).toBeGreaterThanOrEqual(2);
    expect(summary.inferential?.survival?.reportText).toMatch(/Cox-adjusted hazard ratio/i);
    expect(summary.inferential?.survival?.cox?.terms.some((term) => term.name === 'treatment_arm')).toBe(true);

    const evidence: EvidenceItem[] = [
      {
        source: 'pubmed',
        title: 'Anticoagulation safety cohort methods',
        year: 2025,
        authors: ['Clinical Research Group'],
        identifiers: { pmid: '900001' },
        snippet: 'A source-grounded cohort methods reference for anticoagulation safety analyses.',
        fetchedAt: new Date(0).toISOString(),
        provenanceHash: 'sample-source-1',
      },
    ];
    const manuscript: Manuscript = {
      title: 'Original Dataset Analysis of Anticoagulation Safety',
      abstract: {
        background: 'Anticoagulation safety requires source-grounded outcome surveillance [S1].',
        objective: 'To test whether the sample dataset supports publication-grade computed statistics [S1].',
        methods: 'HashCerebrum parsed the uploaded dataset and computed descriptive, inferential, subgroup, and survival analyses in code [S1].',
        results: `${twoByTwo!.reportText} ${summary.inferential!.survival!.reportText}`,
        conclusions: 'The manuscript artifact can narrate computed statistics without model-generated numerical claims [S1].',
      },
      keywords: ['anticoagulation', 'safety', 'cohort'],
      sections: [
        {
          heading: 'Introduction',
          body: ['This synthetic fixture is designed to exercise the original-research manuscript pipeline while keeping every citation source-grounded [S1].'],
        },
        {
          heading: 'Methods',
          body: ['The dataset analysis is computed by deterministic in-app statistics before any manuscript prose is generated, and the manuscript may only narrate those computed values [S1].'],
        },
        {
          heading: 'Results',
          body: [`${twoByTwo!.reportText} ${summary.inferential!.subgroups!.reportText} ${summary.inferential!.survival!.reportText}`],
        },
        {
          heading: 'Discussion',
          body: ['The resulting artifact should include the inferential table, forest plot, and statistics safeguard payload for expert review [S1].'],
        },
        {
          heading: 'Declarations',
          body: ['Synthetic sample dataset for software validation; no real patients or private health information are present.'],
        },
      ],
    };
    const artifact = buildPublicationArtifact(manuscript, evidence, {
      manuscriptType: 'original_research',
      dataset: summary,
    });

    expect(artifact.statistics.mode).toBe('original_dataset');
    expect(artifact.statistics.computedAnalyses).toEqual(expect.arrayContaining([
      'two_by_two',
      'mantel_haenszel_subgroups',
      'kaplan_meier',
      'log_rank',
      'cox_regression',
    ]));
    expect(artifact.figures.some((figure) => figure.kind === 'forest_plot')).toBe(true);
    expect(artifact.tables.some((table) => table.id === 'table-inferential-statistics')).toBe(true);
  });
});
