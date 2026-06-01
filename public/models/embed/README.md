# Bundled embedding model

This folder holds the **offline, in-app embedding model** used by the RAG
medical-memory module (`src/core/rag/`). The model turns text into a 384-number
"meaning fingerprint" so memory retrieval is semantic, not just keyword-matching.

It is **inference-only** — a fixed, pre-trained sentence-embedding model, **not
an LLM**. It cannot generate text. The weights are **committed to the repo and
ship inside the app**, so a clone (and the built app) works with no extra
download and no setup step.

## What's here

```
medembed-small-v0.1/        # default — Apache-2.0 (medical fine-tune of bge-small)
  config.json
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  vocab.txt
  onnx/model_quantized.onnx # int8 (~33 MB) — loaded at dtype 'q8'
  LICENSE.md                # attribution + Apache-2.0 notice
```

The model id + dimension are defined once in `src/core/rag/model.config.ts`.

## Privacy

`transformers.js` runs with `allowRemoteModels = false` and
`localModelPath = '/models/embed/'` (see `src/workers/embed.worker.ts`), so the
model loads **only** from this folder — the app can never download it at runtime.
Embedding is fully local and offline. If the files were ever missing, the app
silently falls back to lexical search.

## Regenerating / swapping the model

The weights are committed, so you normally never touch this. To reproduce or
upgrade them (one-off dev step — not part of build/run):

```sh
python -m venv .venv && . .venv/bin/activate
pip install torch transformers optimum-onnx onnx onnxruntime
python scripts/convert-embed-model.py            # MedEmbed-small (default)
# or: python scripts/convert-embed-model.py <hf_repo> <local_dir_name>
```

Then update `src/core/rag/model.config.ts` if the id/dimension changed, and keep
a `LICENSE.md` next to the new weights (record it in `docs/LICENSES.md`).
