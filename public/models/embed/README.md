# Bundled embedding model

This folder holds the **offline, in-app embedding model** used by the RAG
medical-memory module (`src/core/rag/`). The model turns text into a 384-number
"meaning fingerprint" so memory retrieval is semantic, not just keyword-matching.

It is **inference-only** — a fixed, pre-trained sentence-embedding model, **not
an LLM**. It cannot generate text. The weights ship with the app and never
change.

## Privacy

`transformers.js` is configured with `allowRemoteModels = false` and
`localModelPath = '/models/embed/'` (see `src/workers/embed.worker.ts`), so the
model is loaded **only** from this folder and the app can never download it at
runtime. Embedding is fully local and offline. If these files are absent, the
app silently falls back to lexical search — nothing breaks.

## Expected layout

```
public/models/embed/
  medembed-small-v0.1/      # default — Apache-2.0 (medical fine-tune of bge-small)
    config.json
    tokenizer.json
    tokenizer_config.json
    onnx/model_quantized.onnx
  bge-small-en-v1.5/        # fallback — MIT (prebuilt transformers.js export)
    config.json
    tokenizer.json
    tokenizer_config.json
    onnx/model_quantized.onnx
  LICENSE / NOTICE          # see docs/LICENSES.md
```

The model id + dimension are defined once in `src/core/rag/model.config.ts`.

## How to produce the assets

**Default (MedEmbed-small, Apache-2.0)** — convert to ONNX with HF Optimum:

```sh
pip install "optimum[onnxruntime]"
optimum-cli export onnx \
  --model abhinand/MedEmbed-small-v0.1 \
  --task feature-extraction \
  public/models/embed/medembed-small-v0.1
# then quantise / keep model_quantized.onnx under onnx/
```

**Fallback (bge-small-en-v1.5, MIT)** — already a prebuilt transformers.js
export; download the files from `Xenova/bge-small-en-v1.5`
(`config.json`, `tokenizer*.json`, `onnx/model_quantized.onnx`).

After adding files: vendor the upstream `LICENSE`/`NOTICE` + model card here and
record them in [`docs/LICENSES.md`](../../../docs/LICENSES.md).
