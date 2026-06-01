# MedEmbed-small-v0.1 — license & attribution

This folder contains the **MedEmbed-small-v0.1** sentence-embedding model,
exported to ONNX (int8-quantised) for in-app, offline use.

- **Model:** MedEmbed-small-v0.1 (a medical/clinical fine-tune of bge-small)
- **Author:** Abhinand Balachandran
- **Source:** https://huggingface.co/abhinand/MedEmbed-small-v0.1
- **Project:** https://github.com/abhinand5/MedEmbed
- **License:** Apache License 2.0
- **Base model:** BAAI/bge-small-en-v1.5 (MIT)
- **Use here:** inference only (text → 384-dim embedding). Not an LLM; nothing is
  trained at runtime. Loaded locally with `allowRemoteModels = false`, so it
  never contacts the network.

The Apache-2.0 license permits commercial use, modification, and redistribution
with attribution and retention of this notice. Full Apache-2.0 text:
https://www.apache.org/licenses/LICENSE-2.0

Citation:

```
@misc{balachandran2024medembed,
  author       = {Balachandran, Abhinand},
  title        = {MedEmbed: Medical-Focused Embedding Models},
  year         = {2024},
  howpublished = {\url{https://github.com/abhinand5/MedEmbed}},
}
```
