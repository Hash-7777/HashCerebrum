// Main-thread client for the cross-encoder reranker worker. Mirrors the embedding
// worker client (../embeddings/workerClient.ts): the rest of the RAG module depends
// only on the RerankProvider interface, never on the worker or transformers.js.
//
// The worker is created lazily on first use and degrades gracefully: in an
// environment without Web Workers (node/tests) or if the model fails to load,
// `ready` stays false and `rerank` returns [] — callers then keep the existing
// order, so retrieval is never worse than today.

export interface RerankProvider {
  readonly ready: boolean;
  warmup(): Promise<void>;
  /** Relevance score per passage (higher = more relevant), or [] when unavailable. */
  rerank(query: string, passages: string[]): Promise<number[]>;
}

import { IdleReaper, MODEL_WORKER_IDLE_MS } from '../workerIdle';

interface Pending {
  resolve: (scores: number[]) => void;
  reject: (error: unknown) => void;
}

class WorkerRerankProvider implements RerankProvider {
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
      this.worker = new Worker(new URL('../../../workers/rerank.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event) => this.onMessage(event));
      this.worker.addEventListener('error', () => {
        this._ready = false;
        // Reject all pending promises so callers fall back instead of hanging.
        const err = new Error('reranker worker crashed');
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
    if (!worker) return Promise.resolve(); // no worker env — stays not-ready

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
          this.warmPromise = null; // allow a later retry
          resolve(); // stays not-ready → callers keep existing order
        }
      };
      worker.addEventListener('message', onReady);
      worker.postMessage({ type: 'warmup' });
    });
    return this.warmPromise;
  }

  async rerank(query: string, passages: string[]): Promise<number[]> {
    if (passages.length === 0) return [];
    const worker = this.ensureWorker();
    if (!worker) return [];
    if (!this._ready) await this.warmup();
    if (!this._ready) return [];

    this.reaper.hold();
    const id = (this.seq += 1);
    return new Promise<number[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'rerank', id, query, passages });
    });
  }

  private onMessage(event: MessageEvent): void {
    const data = event.data as { type?: string; id?: number; scores?: number[]; error?: string } | null;
    if (!data || typeof data.id !== 'number') return;
    const pending = this.pending.get(data.id);
    if (!pending) return;
    this.pending.delete(data.id);
    if (this.pending.size === 0) this.reaper.arm();
    if (data.type === 'reranked' && Array.isArray(data.scores)) {
      pending.resolve(data.scores);
    } else if (data.type === 'rerank-error') {
      pending.reject(new Error(typeof data.error === 'string' ? data.error : 'rerank failed'));
    }
  }
}

let singleton: RerankProvider | null = null;

/** The process-wide reranker provider (lazily constructed). */
export function getRerankProvider(): RerankProvider {
  if (!singleton) singleton = new WorkerRerankProvider();
  return singleton;
}
