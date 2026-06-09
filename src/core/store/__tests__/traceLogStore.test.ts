import { beforeEach, describe, expect, it } from 'vitest';
import { useTraceLogStore } from '../traceLogStore';

beforeEach(() => {
  useTraceLogStore.setState({ entries: [], hydrated: true });
});

describe('traceLogStore', () => {
  it('records newest-first across calls', () => {
    const { add } = useTraceLogStore.getState();
    add({ agentId: 'boss', phase: 'start', detail: 'first' });
    add({ agentId: 'evidence_synthesis', phase: 'tool_call', detail: 'second' });
    const { entries } = useTraceLogStore.getState();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.detail).toBe('second');
    expect(entries[1]?.detail).toBe('first');
    expect(entries[0]?.ts).toBeTypeOf('number');
  });

  it('caps the ring buffer so the persistent log cannot grow unbounded', () => {
    const { add } = useTraceLogStore.getState();
    for (let i = 0; i < 2050; i++) add({ agentId: 'boss', phase: 'token', detail: `e${i}` });
    const { entries } = useTraceLogStore.getState();
    expect(entries).toHaveLength(2000);
    // Newest entry is retained, oldest dropped.
    expect(entries[0]?.detail).toBe('e2049');
  });

  it('clear empties the log', () => {
    const { add, clear } = useTraceLogStore.getState();
    add({ agentId: 'system', phase: 'start', detail: 'x' });
    clear();
    expect(useTraceLogStore.getState().entries).toHaveLength(0);
  });
});
