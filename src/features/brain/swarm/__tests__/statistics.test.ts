import { describe, expect, it } from 'vitest';
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
});
