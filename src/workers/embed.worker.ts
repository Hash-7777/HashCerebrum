// In-app embedding worker. Runs a small, fixed, pre-trained sentence-embedding
// model (NOT an LLM — inference only) via transformers.js, off the UI thread.
//
// Privacy: allowRemoteModels=false + a local model path pin the model to the
// app's bundled assets — it can never contact huggingface.co, so embedding is
// fully offline and zero-egress. The model weights ship with the app.

import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBED_LOCAL_PATH, EMBED_MODEL, EMBED_MODEL_FALLBACK } from '../core/rag/model.config';

// Never reach the network: only the bundled local model is allowed.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = EMBED_LOCAL_PATH;

// The DedicatedWorkerGlobalScope without pulling in the "webworker" TS lib
// (the project's lib list is ES2022 + DOM). globalThis is the worker scope here.
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

let extractor: FeatureExtractionPipeline | null = null;
let loadFailed = false;

async function ensureModel(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  let lastError: unknown;
  for (const id of [EMBED_MODEL.id, EMBED_MODEL_FALLBACK.id]) {
    try {
      // q8 = the int8-quantised ONNX (~33 MB) rather than the fp32 weights.
      extractor = await pipeline('feature-extraction', id, { dtype: 'q8' });
      return extractor;
    } catch (error) {
      lastError = error;
    }
  }
  loadFailed = true;
  throw lastError ?? new Error('no embedding model could be loaded');
}

ctx.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type?: string; id?: number; texts?: string[] } | null;
  if (!msg || typeof msg.type !== 'string') return;

  if (msg.type === 'warmup') {
    if (loadFailed) {
      ctx.postMessage({ type: 'load-error', error: 'model previously failed to load' });
      return;
    }
    ensureModel().then(
      () => ctx.postMessage({ type: 'ready' }),
      (err: unknown) => ctx.postMessage({ type: 'load-error', error: String(err) }),
    );
    return;
  }

  if (msg.type === 'embed' && typeof msg.id === 'number' && Array.isArray(msg.texts)) {
    const id = msg.id;
    const texts = msg.texts;
    ensureModel()
      .then(async (model) => {
        const output = await model(texts, { pooling: 'mean', normalize: true });
        const dims = output.dims as number[];
        const data = output.data as Float32Array;
        const dim = dims[dims.length - 1] ?? 0;
        const vectors: number[][] = [];
        for (let i = 0; i < texts.length; i += 1) {
          vectors.push(Array.from(data.subarray(i * dim, (i + 1) * dim)));
        }
        ctx.postMessage({ type: 'embedded', id, vectors });
      })
      .catch((err: unknown) => ctx.postMessage({ type: 'embed-error', id, error: String(err) }));
  }
});
