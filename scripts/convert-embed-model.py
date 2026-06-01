#!/usr/bin/env python3
"""Reproduce the bundled embedding model (public/models/embed/<id>/).

The model weights are committed to the repo so the app ships them automatically
and works fully offline with no extra download — this script is only the
record/regeneration of how they were produced. It is NOT part of the normal
build or run; a clone already has the model.

Requires (a one-off dev env, e.g. a venv):
    pip install torch transformers optimum-onnx onnx onnxruntime

Usage:
    python scripts/convert-embed-model.py            # default: MedEmbed-small
    python scripts/convert-embed-model.py <hf_repo> <local_dir_name>

Produces, under public/models/embed/<local_dir_name>/:
    config.json, tokenizer*.json, vocab.txt, special_tokens_map.json
    onnx/model_quantized.onnx   (int8 — what the app loads at dtype 'q8')

transformers.js applies mean-pooling + normalisation at runtime, so exporting
the base feature-extraction encoder (last_hidden_state) is correct.
"""

import os
import shutil
import sys

from optimum.exporters.onnx import main_export
from onnxruntime.quantization import QuantType, quantize_dynamic

REPO = sys.argv[1] if len(sys.argv) > 1 else "abhinand/MedEmbed-small-v0.1"
NAME = sys.argv[2] if len(sys.argv) > 2 else "medembed-small-v0.1"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.join(ROOT, "public", "models", "embed", NAME)
TMP = os.path.join("/tmp", f"embed-export-{NAME}")

print(f"Exporting {REPO} -> ONNX")
main_export(REPO, output=TMP, task="feature-extraction", opset=14)

onnx_tmp = os.path.join(TMP, "onnx")
os.makedirs(onnx_tmp, exist_ok=True)
root_model = os.path.join(TMP, "model.onnx")
fp32 = os.path.join(onnx_tmp, "model.onnx")
if os.path.exists(root_model):
    shutil.move(root_model, fp32)

print("Quantizing -> model_quantized.onnx (int8)")
quantize_dynamic(fp32, os.path.join(onnx_tmp, "model_quantized.onnx"), weight_type=QuantType.QInt8)

# Copy only what the app needs (small config/tokenizer files + the int8 onnx).
os.makedirs(os.path.join(DEST, "onnx"), exist_ok=True)
for f in ("config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt"):
    src = os.path.join(TMP, f)
    if os.path.exists(src):
        shutil.copy(src, os.path.join(DEST, f))
shutil.copy(os.path.join(onnx_tmp, "model_quantized.onnx"), os.path.join(DEST, "onnx", "model_quantized.onnx"))

print(f"Done -> {DEST}")
print("Remember to keep LICENSE.md / attribution next to the weights.")
