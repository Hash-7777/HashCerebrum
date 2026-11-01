# mobilebert-uncased-mnli — license & attribution

This folder contains **MobileBERT (uncased) fine-tuned on MNLI**, exported to ONNX
(int8-quantised) for in-app, offline natural-language inference.

- **Model:** mobilebert-uncased-mnli
- **Base model:** google/mobilebert-uncased (Apache-2.0)
- **Fine-tune source:** https://huggingface.co/typeform/mobilebert-uncased-mnli
- **ONNX build:** https://huggingface.co/Xenova/mobilebert-uncased-mnli (transformers.js)
- **License:** Apache License 2.0
- **Use here:** inference only (premise + hypothesis → entailment / neutral /
  contradiction probabilities). Not an LLM; nothing is trained at runtime. Loaded
  locally with `allowRemoteModels = false`, so it never contacts the network.

The Apache-2.0 license permits commercial use, modification, and redistribution
with attribution and retention of this notice. The project publishes no NOTICE
file of its own (checked 2026-10-28). The full Apache-2.0 text ships with the
app in `THIRDPARTY-NOTICES.md`, and is published at:
https://www.apache.org/licenses/LICENSE-2.0
