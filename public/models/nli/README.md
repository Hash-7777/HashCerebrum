# Bundled NLI (fact-check) model

This folder holds the **offline, in-app natural-language-inference (NLI) model**
used to fact-check answers (`src/core/rag/`). After an answer is written, it checks
whether each cited sentence is actually **entailed** (supported) by the source it
cites, and flags any that are not.

It is **inference-only** — a fixed, pre-trained cross-encoder, **not an LLM**. When
the weights are present they ship inside the app; if this folder is empty, the
fact-check is **silently skipped** and answers are unchanged — it is a pure add-on.

## What's here

```
mobilebert-uncased-mnli/      # MobileBERT fine-tuned on MNLI — Apache-2.0
  config.json                 # includes id2label (entailment column)
  tokenizer.json
  tokenizer_config.json
  special_tokens_map.json
  vocab.txt
  onnx/model_quantized.onnx   # int8 (~27 MB) — loaded at dtype 'q8'
  LICENSE.md
```

The model id is defined once in `src/core/rag/nli.config.ts`.

## Privacy

`transformers.js` runs with `allowRemoteModels = false` and
`localModelPath = '/models/nli/'` (see `src/workers/nli.worker.ts`), so the model
loads **only** from this folder — it can never download at runtime. Fact-checking
is fully local and offline.

## Adding / regenerating the model (one-off dev step)

```sh
python -m venv .venv && . .venv/bin/activate
pip install torch transformers optimum-onnx onnx onnxruntime
optimum-cli export onnx \
  --model typeform/mobilebert-uncased-mnli \
  --task text-classification \
  mobilebert-uncased-mnli/
# then quantise to int8 as onnx/model_quantized.onnx
```

Keep a `LICENSE.md` next to the weights and record it in `docs/LICENSES.md`.
