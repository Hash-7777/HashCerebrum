import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleReaper, MODEL_WORKER_IDLE_MS } from '../workerIdle';

// A stand-in Worker that answers warm-up and re-rank messages at once, and
// records whether it was terminated.
class FakeWorker {
  static created: FakeWorker[] = [];
  terminated = false;
  private listeners: Array<(event: MessageEvent) => void> = [];
  constructor() {
    FakeWorker.created.push(this);
  }
  addEventListener(type: string, fn: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.push(fn);
  }
  removeEventListener(_type: string, fn: (event: MessageEvent) => void): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }
  postMessage(msg: { type: string; id?: number; passages?: string[] }): void {
    const reply =
      msg.type === 'warmup'
        ? { type: 'ready' }
        : { type: 'reranked', id: msg.id, scores: (msg.passages ?? []).map(() => 1) };
    queueMicrotask(() => this.listeners.forEach((l) => l({ data: reply } as MessageEvent)));
  }
  terminate(): void {
    this.terminated = true;
  }
}

beforeEach(() => {
  FakeWorker.created = [];
  vi.useFakeTimers();
  vi.stubGlobal('Worker', FakeWorker);
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('IdleReaper', () => {
  it('fires once after the quiet spell, and not while held', () => {
    const onIdle = vi.fn();
    const reaper = new IdleReaper(1000, onIdle);
    reaper.arm();
    vi.advanceTimersByTime(900);
    reaper.hold();
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
    reaper.arm();
    vi.advanceTimersByTime(1000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

describe('model worker release', () => {
  it('releases the re-rank worker after the quiet spell and recreates it on the next request', async () => {
    const { getRerankProvider } = await import('../rerank/workerClient');
    const provider = getRerankProvider();
    expect(await provider.rerank('q', ['a', 'b'])).toEqual([1, 1]);
    expect(FakeWorker.created).toHaveLength(1);

    vi.advanceTimersByTime(MODEL_WORKER_IDLE_MS - 1);
    expect(FakeWorker.created[0]!.terminated).toBe(false);
    vi.advanceTimersByTime(1);
    expect(FakeWorker.created[0]!.terminated).toBe(true);
    expect(provider.ready).toBe(false);

    expect(await provider.rerank('q', ['c'])).toEqual([1]);
    expect(FakeWorker.created).toHaveLength(2);
  });

  it('keeps the worker while requests keep arriving inside the window', async () => {
    const { getRerankProvider } = await import('../rerank/workerClient');
    const provider = getRerankProvider();
    await provider.rerank('q', ['a']);
    vi.advanceTimersByTime(MODEL_WORKER_IDLE_MS / 2);
    await provider.rerank('q', ['b']);
    vi.advanceTimersByTime(MODEL_WORKER_IDLE_MS / 2);
    expect(FakeWorker.created[0]!.terminated).toBe(false);
    expect(FakeWorker.created).toHaveLength(1);
  });
});
