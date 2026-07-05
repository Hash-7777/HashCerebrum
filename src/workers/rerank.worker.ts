// In-app cross-encoder reranker worker. Runs a small, fixed, pre-trained
// cross-encoder (NOT an LLM — inference only) via transformers.js, off the UI
// thread. It scores how relevant each passage is to the query by reading the pair
// together, so a cheap second pass can reorder the top retrieved passages.
//
// Privacy: allowRemoteModels=false + a local model path pin the model to the app's
// bundled assets — it can never contact huggingface.co, so reranking is fully
// offline and zero-egress. The weights ship with the app. If the model is missing
// or fails to load, the client stays not-ready and retrieval keeps its existing
// order — nothing breaks.

import { env, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';
import { RERANK_LOCAL_PATH, RERANK_MODEL } from '../core/rag/rerank.config';

// Never reach the network: only the bundled local model is allowed.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = RERANK_LOCAL_PATH;

// The DedicatedWorkerGlobalScope without pulling in the "webworker" TS lib
// (the project's lib list is ES2022 + DOM). globalThis is the worker scope here.
interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

// transformers.js does not export precise types for the tokenizer / seq-class
// model callables (both are callable instances), so these are held loosely.
type Callable = { (...args: unknown[]): unknown };
let tokenizer: Callable | null = null;
let model: Callable | null = null;
let loadFailed = false;

async function ensureModel(): Promise<void> {
  if (tokenizer && model) return;
  try {
    tokenizer = (await AutoTokenizer.from_pretrained(RERANK_MODEL.id)) as unknown as Callable;
    // q8 = the int8-quantised ONNX rather than the fp32 weights.
    model = (await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL.id, {
      dtype: 'q8',
    })) as unknown as Callable;
  } catch (error) {
    loadFailed = true;
    throw error;
  }
}

// Convert the model's per-pair logits into one relevance score per passage. A
// ms-marco cross-encoder has a single output (num_labels = 1); a 2-label reranker
// exposes the "relevant" class as the last column.
function scoresFromLogits(data: Float32Array, count: number): number[] {
  const labels = count > 0 ? data.length / count : 0;
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(labels <= 1 ? (data[i] ?? 0) : (data[i * labels + (labels - 1)] ?? 0));
  }
  return out;
}

ctx.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as
    | { type?: string; id?: number; query?: string; passages?: string[] }
    | null;
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

  if (
    msg.type === 'rerank' &&
    typeof msg.id === 'number' &&
    typeof msg.query === 'string' &&
    Array.isArray(msg.passages)
  ) {
    const id = msg.id;
    const query = msg.query;
    const passages = msg.passages;
    if (passages.length === 0) {
      ctx.postMessage({ type: 'reranked', id, scores: [] });
      return;
    }
    ensureModel()
      .then(async () => {
        const tok = tokenizer;
        const mdl = model;
        if (!tok || !mdl) throw new Error('reranker not loaded');
        const inputs = tok(passages.map(() => query), {
          text_pair: passages,
          padding: true,
          truncation: true,
        });
        const output = (await mdl(inputs)) as { logits: { data: Float32Array } };
        ctx.postMessage({
          type: 'reranked',
          id,
          scores: scoresFromLogits(output.logits.data, passages.length),
        });
      })
      .catch((err: unknown) => ctx.postMessage({ type: 'rerank-error', id, error: String(err) }));
  }
});
