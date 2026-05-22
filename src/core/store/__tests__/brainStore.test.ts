import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialBrainRegions, useBrainStore } from '../brainStore';

describe('brainStore lighting decay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-21T00:00:00.000Z'));
    useBrainStore.setState({ regions: createInitialBrainRegions() });
  });

  afterEach(() => {
    vi.useRealTimers();
    useBrainStore.setState({ regions: createInitialBrainRegions() });
  });

  it('caps long agent light events to a short intelligent hold', () => {
    const now = Date.now();

    useBrainStore.getState().setRegion('frontal', 'agent', 1, 4000);
    const lit = useBrainStore.getState().regions.frontal;

    expect(lit.base).toBe(1);
    expect(lit.baseHoldUntil - now).toBeLessThanOrEqual(700);
    expect(lit.baseHoldUntil - now).toBeGreaterThanOrEqual(240);

    vi.advanceTimersByTime(710);
    useBrainStore.getState().tick(900);

    expect(useBrainStore.getState().regions.frontal.base).toBeCloseTo(0.5);
  });

  it('decays topic sparks faster than agent glow and keeps channels independent', () => {
    useBrainStore.getState().setRegion('temporal', 'agent', 0.9, 4000);
    useBrainStore.getState().setRegion('temporal', 'topic', 0.9, 4500);

    vi.advanceTimersByTime(360);
    useBrainStore.getState().tick(80);
    const first = useBrainStore.getState().regions.temporal;

    expect(first.base).toBeCloseTo(0.9);
    expect(first.accent).toBeLessThan(0.9);

    vi.advanceTimersByTime(360);
    useBrainStore.getState().tick(360);
    const second = useBrainStore.getState().regions.temporal;

    expect(second.base).toBeLessThan(0.9);
    expect(second.accent).toBeLessThan(first.accent);
  });

  it('returns the same state reference when nothing decays', () => {
    const before = useBrainStore.getState();
    useBrainStore.getState().tick(100);
    const after = useBrainStore.getState();
    expect(after).toBe(before);
    expect(after.regions).toBe(before.regions);
  });

  it('returns a new regions object when a value decays', () => {
    useBrainStore.getState().setRegion('frontal', 'agent', 1, 0);
    vi.advanceTimersByTime(1000);

    const before = useBrainStore.getState();
    useBrainStore.getState().tick(100);
    const after = useBrainStore.getState();

    expect(after).not.toBe(before);
    expect(after.regions).not.toBe(before.regions);
    expect(after.regions.frontal.base).toBeLessThan(before.regions.frontal.base);
  });
});
