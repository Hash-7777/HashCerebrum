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
    expect(datasetSummaryForPrompt(summary)).toContain('Allowed use: narrate these computed descriptive statistics only');
  });
});
