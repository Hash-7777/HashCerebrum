// Main-thread client for the embedding worker. Implements EmbeddingProvider so
// the rest of the RAG module depends only on the interface, never on the worker
// or transformers.js directly — that keeps the search/store layers pure and lets
// a different provider (e.g. an optional cloud one) drop in later.
//
// The worker is created lazily on first use and degrades gracefully: in an
// environment without Web Workers (node/tests) or if the model fails to load,
// `ready` stays false and `embed` returns [], so callers fall back to lexical
// search and nothing breaks.

import type { EmbeddingProvider, EmbeddingVector } from '../types';

interface Pending {
  resolve: (vectors: EmbeddingVector[]) => void;
  reject: (error: unknown) => void;
}

class WorkerEmbeddingProvider implements EmbeddingProvider {
  private worker: Worker | null = null;
  private workerUnavailable = false;
  private _ready = false;
  private warmPromise: Promise<void> | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();

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
      this.worker = new Worker(new URL('../../../workers/embed.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (event) => this.onMessage(event));
      this.worker.addEventListener('error', () => {
        this._ready = false;
        // RAG-001: reject all pending promises so they don't hang forever.
        const err = new Error('embedding worker crashed');
        for (const pending of this.pending.values()) {
          pending.reject(err);
        }
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
          resolve();
        } else if (data?.type === 'load-error') {
          worker.removeEventListener('message', onReady);
          this.warmPromise = null; // allow a later retry
          resolve(); // stays not-ready → lexical fallback
        }
      };
      worker.addEventListener('message', onReady);
      worker.postMessage({ type: 'warmup' });
    });
    return this.warmPromise;
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    if (texts.length === 0) return [];
    const worker = this.ensureWorker();
    if (!worker) return [];
    if (!this._ready) await this.warmup();
    if (!this._ready) return [];

    const id = (this.seq += 1);
    return new Promise<EmbeddingVector[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: 'embed', id, texts });
    });
  }

  private onMessage(event: MessageEvent): void {
    const data = event.data as { type?: string; id?: number; vectors?: number[][]; error?: string } | null;
    if (!data || typeof data.id !== 'number') return;
    const pending = this.pending.get(data.id);
    if (!pending) return;
    this.pending.delete(data.id);
    if (data.type === 'embedded' && Array.isArray(data.vectors)) {
      pending.resolve(data.vectors.map((v) => Float32Array.from(v)));
    } else if (data.type === 'embed-error') {
      pending.reject(new Error(typeof data.error === 'string' ? data.error : 'embed failed'));
    }
  }
}

let singleton: EmbeddingProvider | null = null;

/** The process-wide embedding provider (lazily constructed). */
export function getEmbeddingProvider(): EmbeddingProvider {
  if (!singleton) singleton = new WorkerEmbeddingProvider();
  return singleton;
}
