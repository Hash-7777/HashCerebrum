import { describe, expect, it, vi } from 'vitest';
import { emitBrainFrame, onBrainFrame } from '../brainFrames';

describe('brain frame broadcast', () => {
  it('calls each listener once per rendered frame and stops after unsubscribe', () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = onBrainFrame(a);
    const offB = onBrainFrame(b);
    emitBrainFrame();
    emitBrainFrame();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
    offA();
    emitBrainFrame();
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(3);
    offB();
  });

  it('does nothing when no frame is drawn', () => {
    const a = vi.fn();
    const off = onBrainFrame(a);
    expect(a).not.toHaveBeenCalled();
    off();
  });
});
