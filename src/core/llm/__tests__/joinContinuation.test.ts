import { describe, expect, it } from 'vitest';
import { joinContinuation } from '../ProviderRegistry';

describe('joinContinuation', () => {
  it('puts back the space a new reply drops between two words', () => {
    expect('This is a summary' + joinContinuation('This is a summary', 'of the retrieved records')).toBe(
      'This is a summary of the retrieved records',
    );
    expect('strong' + joinContinuation('strong', 'directional support')).toBe('strong directional support');
  });

  it('removes the words the continuation repeats', () => {
    const written = 'The honest summary is: strong';
    expect(written + joinContinuation(written, 'summary is: strong directional support')).toBe(
      'The honest summary is: strong directional support',
    );
  });

  it('mends a word cut in half when the repeat completes it', () => {
    const written = 'This is a summ';
    expect(written + joinContinuation(written, 'This is a summary of the records')).toBe(
      'This is a summary of the records',
    );
  });

  it('keeps punctuation joins tight', () => {
    expect('the trials' + joinContinuation('the trials', ', which')).toBe('the trials, which');
    expect('end.' + joinContinuation('end.', 'Next sentence')).toBe('end. Next sentence');
  });

  it('adds nothing when what was written already ends in whitespace', () => {
    expect('a summary\n\n' + joinContinuation('a summary\n\n', '## Gaps')).toBe('a summary\n\n## Gaps');
  });

  it('does not clip a continuation that only shares letters with the end of a word', () => {
    const written = 'the effect was seen in';
    // "in" ends the written text but "inhibitors" is a new word, not a repeat.
    expect(written + joinContinuation(written, 'inhibitors of the transporter')).toBe(
      'the effect was seen in inhibitors of the transporter',
    );
  });
});
