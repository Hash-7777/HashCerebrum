# ms-marco-MiniLM-L-6-v2 — license & attribution

This folder contains the **ms-marco-MiniLM-L-6-v2** cross-encoder reranker,
exported to ONNX (int8-quantised) for in-app, offline use.

- **Model:** cross-encoder/ms-marco-MiniLM-L-6-v2
- **Author:** UKPLab / Sentence-Transformers (Nils Reimers, Iryna Gurevych)
- **Source:** https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2
- **ONNX build:** https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2 (transformers.js)
- **License:** Apache License 2.0
- **Base model:** microsoft/MiniLM-L6 (MIT)
- **Use here:** inference only (question + passage → one relevance score). Not an
  LLM; nothing is trained at runtime. Loaded locally with
  `allowRemoteModels = false`, so it never contacts the network.

The Apache-2.0 license permits commercial use, modification, and redistribution
with attribution and retention of this notice. Full Apache-2.0 text:
https://www.apache.org/licenses/LICENSE-2.0

Citation:

```
@inproceedings{reimers-2019-sentence-bert,
  author    = {Reimers, Nils and Gurevych, Iryna},
  title     = {Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks},
  booktitle = {Proceedings of the 2019 Conference on Empirical Methods in
               Natural Language Processing},
  year      = {2019},
  url       = {https://arxiv.org/abs/1908.10084},
}
```
