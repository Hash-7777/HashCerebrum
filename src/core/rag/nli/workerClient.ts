// Main-thread client for the NLI (fact-check) worker. Mirrors the reranker client:
// the rest of the app depends only on the NliProvider interface. Degrades
// gracefully — no Web Worker (node/tests) or a failed model load leaves `ready`
// false and entailment() returns [], so callers skip the fact-check (fail-open).

export interface NliProvider {
  readonly ready: boolean;
  warmup(): Promise<void>;
  /** Entailment probability [0..1] that `premise` supports each hypothesis, or []. */
  entailment(premise: string, hypotheses: string[]): Promise<number[]>;
}

import { IdleReaper, MODEL_WORKER_IDLE_MS } from '../workerIdle';

interface Pending {
  resolve: (scores: number[]) => void;
  reject: (error: unknown) => void;
}

class WorkerNliProvider implements NliProvider {
  private worker: Worker | null = null;
  private workerUnavailable = false;
  private _ready = false;
  private warmPromise: Promise<void> | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  // Releases the worker, and the model memory it holds, after a quiet spell.
  private readonly reaper = new IdleReaper(MODEL_WORKER_IDLE_MS, () => this.releaseIfIdle());

  private releaseIfIdle(): void {
    // Never while a request or a model load is in flight.
    if (!this.worker || this.pending.size > 0 || (this.warmPromise && !this._ready)) return;
    this.worker.terminate();
    this.worker = null;
    this._ready = false;
    this.warmPromise = null;
  }

  get ready(): boolean {
    return this._ready;
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerUnavailable || typeof Worker === 'undefined') {
      this.workerUnavailable = true;
      return null;
    }
    try {
      this.worker = new Worker(new URL('../../../workers/nli.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event) => this.onMessage(event));
      this.worker.addEventListener('error', () => {
        this._ready = false;
        const err = new Error('nli worker crashed');
        for (const pending of this.pending.values()) pending.reject(err);
        this.pending.clear();
      });
      return this.worker;
    } catch {
      this.workerUnavailable = true;
      return null;
    }
  }

  warmup(): Promise<void> {
    if (this._ready) return Promise.resolve();
    if (this.warmPromise) return this.warmPromise;
    const worker = this.ensureWorker();
    if (!worker) return Promise.resolve();

    this.warmPromise = new Promise<void>((resolve) => {
      const onReady = (event: MessageEvent) => {
        const data = event.data as { type?: string } | null;
        if (data?.type === 'ready') {
          this._ready = true;
          worker.removeEventListener('message', onReady);
          this.reaper.arm();
          resolve();
        } else if (data?.type === 'load-error') {
          worker.removeEventListener('message', onReady);
          this.warmPromise = null;
          resolve();
        }
      };
      worker.addEventListener('message', onReady);
      worker.postMessage({ type: 'warmup' });
    });
    return this.warmPromise;
  }

  async entailment(premise: string, hypotheses: string[]): Promise<number[]> {
    if (hypotheses.length === 0) return [];
    const worker = this.ensureWorker();
    if (!worker) return [];
    if (!this._ready) await this.warmup();
    if (!this._ready) return [];

    this.reaper.hold();
    const id = (this.seq += 1);
    return new Promise<number[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'verify', id, premise, hypotheses });
    });
  }

  private onMessage(event: MessageEvent): void {
    const data = event.data as { type?: string; id?: number; scores?: number[]; error?: string } | null;
    if (!data || typeof data.id !== 'number') return;
    const pending = this.pending.get(data.id);
    if (!pending) return;
    this.pending.delete(data.id);
    if (this.pending.size === 0) this.reaper.arm();
    if (data.type === 'verified' && Array.isArray(data.scores)) {
      pending.resolve(data.scores);
    } else if (data.type === 'verify-error') {
      pending.reject(new Error(typeof data.error === 'string' ? data.error : 'verify failed'));
    }
  }
}

let singleton: NliProvider | null = null;

/** The process-wide NLI provider (lazily constructed). */
export function getNliProvider(): NliProvider {
  if (!singleton) singleton = new WorkerNliProvider();
  return singleton;
}
