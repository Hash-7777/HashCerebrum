import { describe, expect, it } from 'vitest';
import { containsPromptLeakage, removeMarkdownTables, sectionBodyFromReply } from '../manuscript';

describe('manuscript section cleanup', () => {
  it('converts markdown tables into prose before manuscript storage', () => {
    const cleaned = removeMarkdownTables(`
| Record | Design | Finding |
|---|---|---|
| [S1] Trial | crossover PK study | warfarin exposure changed |
| [S2] Registry | cohort signal | bleeding risk increased |
`);

    expect(cleaned).not.toContain('|');
    expect(cleaned).not.toContain('---');
    expect(cleaned).toContain('Record: [S1] Trial; Design: crossover PK study; Finding: warfarin exposure changed');
    expect(cleaned).toContain('Record: [S2] Registry; Design: cohort signal; Finding: bleeding risk increased');
  });

  it('drops echoed headings and does not preserve table syntax in section bodies', () => {
    const paragraphs = sectionBodyFromReply(
      'Trial and Registry Evidence',
      `
## Trial and Registry Evidence

| Trial | Population | Relevance |
|---|---|---|
| [S4] NCT0001 | adults | indirect evidence |

The remaining registry evidence is limited but clinically relevant [S5].
`,
    );

    expect(paragraphs[0]).toContain('Trial: [S4] NCT0001; Population: adults; Relevance: indirect evidence');
    expect(paragraphs.join(' ')).not.toContain('|');
    expect(paragraphs.join(' ')).not.toContain('---');
    expect(paragraphs.at(-1)).toContain('registry evidence is limited');
  });

  it('strips leaked prompt blocks before manuscript storage', () => {
    const paragraphs = sectionBodyFromReply(
      'Methods',
      `
Manuscript topic: warfarin interactions

Retrieved records:
[S1] PubMed record supplied to the model

Specialist findings:
Use only these notes.

Methods

The automated evidence review queried guarded biomedical sources and synthesized retrieved records with source markers [S1].
`,
    );

    const body = paragraphs.join(' ');
    expect(body).toContain('queried guarded biomedical sources');
    expect(body).not.toContain('Manuscript topic');
    expect(body).not.toContain('Retrieved records');
    expect(containsPromptLeakage(body)).toBe(false);
  });

  it('detects an imperative prompt phrase even mid-paragraph', () => {
    // Leakage that does not start the paragraph used to slip past the
    // startsWith() check; it is now caught anywhere in the block.
    expect(
      containsPromptLeakage(
        'This section synthesizes the evidence. Do not invent p-values that are absent from the records.',
      ),
    ).toBe(true);
  });

  it('does not flag legitimate clinical "Allowed use" prose as leakage', () => {
    // "Allowed use:" is ordinary drug-label wording and must not trip the
    // prompt-leak detector.
    expect(
      containsPromptLeakage('Allowed use: maintenance therapy in adults with moderate persistent asthma.'),
    ).toBe(false);
  });
});
