// In-app NLI worker. Runs a small, fixed, pre-trained natural-language-inference
// cross-encoder (NOT an LLM — inference only) via transformers.js, off the UI
// thread. Given a premise (source text) and hypotheses (answer sentences), it
// returns the entailment probability of each hypothesis — how strongly the source
// supports the claim.
//
// Privacy: allowRemoteModels=false + a local model path pin the model to the app's
// bundled assets — fully offline, zero-egress. If the model is missing or fails to
// load, the client stays not-ready and the fact-check is skipped (fail-open), so
// answers are never blocked.

import { env, AutoTokenizer, AutoModelForSequenceClassification } from '@huggingface/transformers';
import { NLI_LOCAL_PATH, NLI_MODEL } from '../core/rag/nli.config';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = NLI_LOCAL_PATH;

interface WorkerScope {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
const ctx = globalThis as unknown as WorkerScope;

type Callable = { (...args: unknown[]): unknown };
let tokenizer: Callable | null = null;
let model: Callable | null = null;
let entailmentIndex = 0;
let loadFailed = false;

async function ensureModel(): Promise<void> {
  if (tokenizer && model) return;
  try {
    tokenizer = (await AutoTokenizer.from_pretrained(NLI_MODEL.id)) as unknown as Callable;
    const loaded = (await AutoModelForSequenceClassification.from_pretrained(NLI_MODEL.id, {
      dtype: 'q8',
    })) as unknown as Callable & { config?: { id2label?: Record<string, string> } };
    model = loaded;
    // Find the entailment column from the model's own label map, so a swapped
    // model with a different label order still works without a code change.
    const id2label = loaded.config?.id2label ?? {};
    for (const [idx, label] of Object.entries(id2label)) {
      if (String(label).toLowerCase() === 'entailment') {
        entailmentIndex = Number(idx);
        break;
      }
    }
  } catch (error) {
    loadFailed = true;
    throw error;
  }
}

// Softmax the per-row logits and return the entailment probability of each row.
function entailmentProbs(data: Float32Array, rows: number): number[] {
  const cols = rows > 0 ? data.length / rows : 0;
  const out: number[] = [];
  for (let r = 0; r < rows; r += 1) {
    let max = -Infinity;
    for (let c = 0; c < cols; c += 1) max = Math.max(max, data[r * cols + c] ?? -Infinity);
    let sum = 0;
    for (let c = 0; c < cols; c += 1) sum += Math.exp((data[r * cols + c] ?? -Infinity) - max);
    const e = Math.exp((data[r * cols + entailmentIndex] ?? -Infinity) - max);
    out.push(sum > 0 ? e / sum : 0);
  }
  return out;
}

ctx.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as
    | { type?: string; id?: number; premise?: string; hypotheses?: string[] }
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
    msg.type === 'verify' &&
    typeof msg.id === 'number' &&
    typeof msg.premise === 'string' &&
    Array.isArray(msg.hypotheses)
  ) {
    const id = msg.id;
    const premise = msg.premise;
    const hypotheses = msg.hypotheses;
    if (hypotheses.length === 0) {
      ctx.postMessage({ type: 'verified', id, scores: [] });
      return;
    }
    ensureModel()
      .then(async () => {
        const tok = tokenizer;
        const mdl = model;
        if (!tok || !mdl) throw new Error('nli model not loaded');
        const inputs = tok(hypotheses.map(() => premise), {
          text_pair: hypotheses,
          padding: true,
          truncation: true,
        });
        const output = (await mdl(inputs)) as { logits: { data: Float32Array } };
        ctx.postMessage({
          type: 'verified',
          id,
          scores: entailmentProbs(output.logits.data, hypotheses.length),
        });
      })
      .catch((err: unknown) => ctx.postMessage({ type: 'verify-error', id, error: String(err) }));
  }
});
