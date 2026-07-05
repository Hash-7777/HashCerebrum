import { describe, expect, it } from 'vitest';
import { bestOverlapSentence, findSupportingSpans } from '../citationSpans';

describe('bestOverlapSentence', () => {
  it('picks the source sentence sharing the most claim words', () => {
    const claim = 'Warfarin increased the risk of major bleeding.';
    const source =
      'The cohort was recruited over two years. Warfarin significantly increased major bleeding events. Follow-up lasted twelve months.';
    expect(bestOverlapSentence(claim, source)).toContain('increased major bleeding');
  });

  it('returns empty when nothing overlaps', () => {
    expect(bestOverlapSentence('quantum chromodynamics', 'The cat sat on the mat.')).toBe('');
  });
});

describe('findSupportingSpans', () => {
  it('maps each [S#] marker to the supporting sentence in its source', () => {
    const answer = 'Warfarin raises bleeding risk [S1]. Aspirin lowers cardiovascular events [S2].';
    const citations = [
      { snippet: 'Warfarin significantly increased major bleeding in the trial arm.' },
      { snippet: 'Aspirin reduced cardiovascular events among high-risk adults.' },
    ];
    const spans = findSupportingSpans(answer, citations);
    expect(spans[0]).toContain('bleeding');
    expect(spans[1]).toContain('cardiovascular events');
  });

  it('handles bare [1] markers and uncited sources', () => {
    const answer = 'Statins reduce LDL cholesterol markedly [1].';
    const citations = [
      { snippet: 'Statin therapy markedly reduced LDL cholesterol.' },
      { snippet: 'An unrelated, uncited source about kidney stones.' },
    ];
    const spans = findSupportingSpans(answer, citations);
    expect(spans[0]).toContain('LDL cholesterol');
    expect(spans[1]).toBe(''); // uncited → no span
  });

  it('returns empty spans when a source has no snippet', () => {
    const spans = findSupportingSpans('Claim [S1].', [{ snippet: null }]);
    expect(spans[0]).toBe('');
  });
});
