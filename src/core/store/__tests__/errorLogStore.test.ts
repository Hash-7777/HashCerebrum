import { describe, it, expect, beforeEach } from 'vitest';
import { useErrorLogStore } from '../errorLogStore';

describe('errorLogStore', () => {
  beforeEach(() => useErrorLogStore.getState().clear());

  it('captures errors newest-first', () => {
    const { push } = useErrorLogStore.getState();
    push({ source: 'window', message: 'first' });
    push({ source: 'promise', message: 'second' });
    const { errors } = useErrorLogStore.getState();
    expect(errors[0]!.message).toBe('second');
    expect(errors[0]!.source).toBe('promise');
    expect(errors[1]!.message).toBe('first');
  });

  it('collapses an immediate duplicate (same source + message)', () => {
    const { push } = useErrorLogStore.getState();
    push({ source: 'console', message: 'boom' });
    push({ source: 'console', message: 'boom' });
    expect(useErrorLogStore.getState().errors).toHaveLength(1);
  });

  it('keeps a different message as a separate entry', () => {
    const { push } = useErrorLogStore.getState();
    push({ source: 'console', message: 'a' });
    push({ source: 'console', message: 'b' });
    expect(useErrorLogStore.getState().errors).toHaveLength(2);
  });

  it('falls back to a placeholder for an empty message', () => {
    useErrorLogStore.getState().push({ source: 'window', message: '' });
    expect(useErrorLogStore.getState().errors[0]!.message).toBe('Unknown error');
  });

  it('records the level, defaulting to error and accepting warn', () => {
    const { push } = useErrorLogStore.getState();
    push({ source: 'console', message: 'an error' });
    expect(useErrorLogStore.getState().errors[0]!.level).toBe('error');
    push({ source: 'console', message: 'a warning', level: 'warn' });
    expect(useErrorLogStore.getState().errors[0]!.level).toBe('warn');
  });

  it('clear empties the log', () => {
    useErrorLogStore.getState().push({ source: 'window', message: 'x' });
    useErrorLogStore.getState().clear();
    expect(useErrorLogStore.getState().errors).toHaveLength(0);
  });
});
