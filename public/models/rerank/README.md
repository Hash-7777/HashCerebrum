# Bundled reranker model

This folder holds the **offline, in-app cross-encoder reranker** used by the RAG
retrieval layer (`src/core/rag/`). After the app finds candidate papers, the
reranker reads each (question, passage) pair **together** and scores true
relevance, so the most on-topic sources are pushed to the top.

It is **inference-only** — a fixed, pre-trained cross-encoder, **not an LLM**. It
cannot generate text. When the weights are present they ship inside the app; if
this folder is empty, the app **silently keeps its existing search order** — the
reranker is a pure add-on and its absence changes nothing.

## What's here (once vendored)

```
ms-marco-MiniLM-L-6-v2/       # default — Apache-2.0 cross-encoder
  config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  vocab.txt
  onnx/model_quantized.onnx   # int8 — loaded at dtype 'q8'
  LICENSE.md                  # attribution + Apache-2.0 notice
```

The model id is defined once in `src/core/rag/rerank.config.ts`.

## Privacy

`transformers.js` runs with `allowRemoteModels = false` and
`localModelPath = '/models/rerank/'` (see `src/workers/rerank.worker.ts`), so the
model loads **only** from this folder — the app can never download it at runtime.
Reranking is fully local and offline.

## Adding / regenerating the model (one-off dev step)

The reranker is optional; the app runs without it. To enable it, convert the
cross-encoder to ONNX and drop the files here:

```sh
python -m venv .venv && . .venv/bin/activate
pip install torch transformers optimum-onnx onnx onnxruntime
optimum-cli export onnx \
  --model cross-encoder/ms-marco-MiniLM-L-6-v2 \
  --task text-classification \
  ms-marco-MiniLM-L-6-v2/
# then quantise to int8 as onnx/model_quantized.onnx (see scripts/ for the embed
# model's conversion for the exact quantisation step to mirror)
```

Keep a `LICENSE.md` next to the weights and record it in `docs/LICENSES.md`. No
code change is needed — the worker picks the files up automatically.
