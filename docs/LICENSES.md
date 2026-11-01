# Third-party asset licenses

All bundled binary assets must be reviewed here before each release.

## 3D models

### `public/models/brain/science-museum-human-brain.glb`

- **Title:** Model of a human brain
- **Source:** Science Museum Group / Sketchfab
- **License:** CC0-1.0 Universal — public-domain dedication
- **License file:** [public/models/brain/LICENSE.md](../public/models/brain/LICENSE.md)
- **Original URL:** https://sketchfab.com/3d-models/model-of-a-human-brain-fc7ae7b989f94c80a50152e71f44e47c
- **Notes:** No attribution legally required under CC0. We attribute anyway as a courtesy in the in-app `BRAIN_MODEL.source` string.
- **Audited:** 2026-05-19

## Rust / Cargo dependencies — notable copyleft / patent-sensitive

### Typst (typesetting engine)

- **Crates:** `typst-as-lib 0.15`, `typst-pdf 0.14`, `typst-assets 0.14`
- **License:** Apache 2.0
- **Source:** https://github.com/typst/typst
- **Usage:** Embedded at compile time in `src-tauri`; used to render research manuscripts to PDF. `typst-assets` bundles the Typst built-in font files (used only by the Typst renderer, not as UI fonts).
- **Obligations under Apache 2.0:**
  - Retain all NOTICE files from Typst in any binary distribution.
  - State that modifications were made if you fork the Typst source.
  - No additional patent grant obligations beyond what Apache 2.0 provides.
- **NOTICE file location:** Cargo unpacks crates to `~/.cargo/registry/src/`; for release builds the Tauri bundler copies the binary. A `NOTICE` file is not required in the repo itself, only in the distributed binary if one is produced.
- **Audited:** 2026-05-24

## Fonts

UI fonts are **self-hosted** via the `@fontsource/*` npm packages and bundled
into `dist/` at build time (imported in `src/main.tsx`). They are **not** fetched
from Google Fonts at runtime — the Tauri CSP (`font-src 'self' data:`) blocks
external font origins, and self-hosting keeps the app fully offline. Each
`@fontsource` package ships its `LICENSE` file in `node_modules`.

| Family | npm package | License |
|---|---|---|
| Source Serif 4 | `@fontsource/source-serif-4` | SIL Open Font License 1.1 |
| Source Sans 3 | `@fontsource/source-sans-3` | SIL Open Font License 1.1 |
| IBM Plex Mono | `@fontsource/ibm-plex-mono` | SIL Open Font License 1.1 |
| Newsreader | `@fontsource/newsreader` | SIL Open Font License 1.1 |

The SIL OFL 1.1 permits bundling and embedding in an application (including a
commercial one) without restriction. The only obligation is that the OFL text
accompany the font binaries; a distributed build should therefore include the
OFL license text alongside the bundled fonts (see "Attribution bundle" below).

### `public/fonts/DejaVuSerif.ttf`, `public/fonts/DejaVuSerif-Bold.ttf`

- **Title:** DejaVu Serif (regular + bold)
- **Source:** DejaVu Fonts project, distributed via the `dejavu-fonts-ttf` npm package (v2.37.3).
- **License:** Bitstream Vera Fonts Copyright + Arev Fonts Copyright (permissive; allows redistribution and embedding). Full text vendored at [`public/fonts/LICENSE.txt`](../public/fonts/LICENSE.txt).
- **Usage:** Embedded into jsPDF at export time (`src/features/brain/export/paperPdf.ts`) so downloaded research-paper PDFs can render Greek letters and math/relation/arrow glyphs that the built-in WinAnsi "times" font cannot draw. Lazily fetched from `/fonts/` on first export; not part of the JS bundle. The font is vendored (not fetched from a CDN) so PDF export works fully offline.
- **Audit date:** 2026-05-31.

## JavaScript / npm dependencies

Notable bundled runtime dependencies (all permissive):

| Package | License | Notes |
|---|---|---|
| react, react-dom, three, @react-three/* | MIT | UI + 3D |
| zustand | MIT | state |
| dompurify | MPL-2.0 OR Apache-2.0 | SVG/HTML sanitisation; used unmodified (MPL only binds if you modify its own files) |
| jspdf | MIT | client PDF export |
| pdfjs-dist | Apache-2.0 | renders uploaded PDFs to canvas in Peer Review; ships the Apache NOTICE |
| xlsx (SheetJS) | Apache-2.0 | dataset parsing |
| @tauri-apps/* | MIT OR Apache-2.0 | desktop shell |
| @huggingface/transformers | Apache-2.0 | in-app embedding inference (RAG memory); ships the Apache NOTICE |
| onnxruntime-web (transitive via @huggingface/transformers) | MIT | WASM model runtime for the embedder |

## Embedding model (RAG medical memory)

The semantic memory uses a small, fixed, **pre-trained sentence-embedding model**
(inference only — not an LLM, nothing is trained) bundled under
`public/models/embed/` and run fully offline via `@huggingface/transformers`
(`allowRemoteModels=false`).

| Asset | License | Notes |
|---|---|---|
| `abhinand/MedEmbed-small-v0.1` (default, **committed & bundled**) | Apache-2.0 | medical/clinical fine-tune of bge-small; exported to int8 ONNX and vendored at `public/models/embed/medembed-small-v0.1/` with `LICENSE.md`. Ships in the app. |
| `BAAI/bge-small-en-v1.5` (optional fallback) | MIT | same 384-dim drop-in; not bundled by default — regenerate with `scripts/convert-embed-model.py` if needed. |

Models **rejected for licensing** (kept out of the tree on purpose): BioLORD-2023
(commercial use conditional on UMLS/SNOMED-CT licensing) and EmbeddingGemma /
its medical fine-tune (governed by Google's non-OSI Gemma Terms). Both would
conflict with clean, commercial, AGPL-compatible distribution.

Vendoring + the upstream `LICENSE`/`NOTICE`/model-card files live next to the
weights in `public/models/embed/` (see that folder's `README.md`).

## Reranker model (RAG retrieval precision)

Retrieval uses a small, fixed, **pre-trained cross-encoder reranker** (inference
only — not an LLM) bundled under `public/models/rerank/` and run fully offline via
`@huggingface/transformers` (`allowRemoteModels=false`). It rescores the top
retrieved passages against the question. It is optional: if the folder is empty the
app keeps its existing search order.

| Asset | License | Notes |
|---|---|---|
| `cross-encoder/ms-marco-MiniLM-L-6-v2` (**committed & bundled**) | Apache-2.0 | MS MARCO cross-encoder; ONNX build via `Xenova/ms-marco-MiniLM-L-6-v2`, int8-quantised, vendored at `public/models/rerank/ms-marco-MiniLM-L-6-v2/` with `LICENSE.md`. Base model microsoft/MiniLM-L6 (MIT). |

Vendoring + the upstream `LICENSE`/model-card files live next to the weights in
`public/models/rerank/` (see that folder's `README.md`).

## NLI / fact-check model (answer verification)

Answers are fact-checked with a small, fixed, **pre-trained NLI cross-encoder**
(inference only — not an LLM) bundled under `public/models/nli/` and run fully
offline via `@huggingface/transformers` (`allowRemoteModels=false`). It checks
whether each cited sentence is entailed by its source. Optional: if the folder is
empty the fact-check is silently skipped.

| Asset | License | Notes |
|---|---|---|
| `mobilebert-uncased-mnli` (**committed & bundled**) | Apache-2.0 | MobileBERT fine-tuned on MNLI; ONNX build via `Xenova/mobilebert-uncased-mnli`, int8-quantised, vendored at `public/models/nli/mobilebert-uncased-mnli/` with `LICENSE.md`. Base model google/mobilebert-uncased (Apache-2.0). |

Vendoring + the upstream `LICENSE`/model-card files live next to the weights in
`public/models/nli/` (see that folder's `README.md`).

## Full dependency-license review

Both trees are reviewed end to end, and the review is re-run with
`npm run licenses`, which rebuilds the inventory and the notices from the
lockfiles. Counts change with every dependency bump and are therefore kept in
the generated [`THIRDPARTY-LICENSES.md`](../THIRDPARTY-LICENSES.md), not
repeated here. What holds, and is checked on each pass:

- **npm.** No GPL-only, SSPL, BUSL or non-commercial licenses. Two non-obvious entries were checked by hand and stay checked: `webgl-constants` (blank `license` field, ships an MIT `LICENSE`) and `rgbcolor` (`MIT OR SEE LICENSE IN FEEL-FREE.md`) — both permissive. `jszip` is `MIT OR GPL-3.0-or-later`; MIT is the option taken.
- **Cargo.** No GPL/AGPL. The only copyleft mentions are benign: `r-efi` is `MIT OR Apache-2.0 OR LGPL-2.1-or-later` (MIT/Apache is selected, LGPL irrelevant), and five crates are `MPL-2.0` (file-level copyleft, used unmodified). Everything else is MIT / Apache-2.0 / BSD / ISC / Zlib / Unicode-3.0 / Unlicense / 0BSD / BSL-1.0 / CC0 / CDLA-Permissive-2.0.
- **Embedding, reranking and fact-check stack.** `@huggingface/transformers` (Apache-2.0) and its transitive `onnxruntime-web` (MIT), plus the bundled embedding model (Apache-2.0 default / MIT fallback) — all permissive, no GPL/AGPL/non-commercial.
- **The one weak-copyleft entry.** `@huggingface/transformers` also pulls in `sharp`, whose libvips binaries are `LGPL-3.0-or-later`. It is an optional, Node-only image library: the app bundle does not include it (checked 2026-09-15 by searching the built JavaScript), and LGPL-3.0 is compatible with AGPL-3.0 in any case. The current list, with every package's declared license, is in [`THIRDPARTY-LICENSES.md`](../THIRDPARTY-LICENSES.md).

**Conclusion:** nothing in the project can force it to be open-sourced, and every dependency and asset grants commercial use. The only standing obligation is **attribution** — reproducing the third-party copyright/permission notices in the distributed app (see below).

## Attribution bundle (release obligation)

Permissive licenses (MIT, BSD, Apache-2.0, OFL-1.1) require that their copyright
and permission notices travel with any binary distribution; Apache-2.0 also
requires retaining upstream `NOTICE` files. **Done.** Two generated files cover
it, both written by `npm run licenses`:

- [`THIRDPARTY-LICENSES.md`](../THIRDPARTY-LICENSES.md) — the inventory. Every
  crate and npm package in the two lockfiles with its version and declared
  license, plus a count per license.
- [`THIRDPARTY-NOTICES.md`](../THIRDPARTY-NOTICES.md) — the notices themselves,
  reproduced word for word: each package's own `LICENSE`, `COPYING`, `NOTICE`
  and `LICENSE.spdx` text. Identical text is printed once with every package
  that ships it listed above it. Packages that publish no notice file at all
  are listed separately with the license and authors their manifest declares,
  so the gap is visible rather than hidden.

The notices file is narrower than the inventory on purpose: it carries what a
user receives. Every crate in `Cargo.lock` is in (one notices file ships with
every platform's build), but on the npm side only packages whose code or assets
the production frontend build actually includes — measured by running the real
build, worker builds included — so build and test tooling and optional native
packages stay out. It also covers the license files vendored next to the
bundled fonts and model weights in `public/`.

`src-tauri/tauri.conf.json` ships `LICENSE`, the inventory and the notices in
the app bundle's resource folder, so a distributed build carries all three, and
**Settings > Licenses** reads them from there: the notices are listed one row
per notice and searchable by package, version or license file, and the other
two documents open in full. The renderer names a document by a fixed enum
(`read_license_document`), never by path.

**Before every release:** re-run `npm run licenses` and commit the result. The
npm half is measured from the build, so app code changes — not only dependency
changes — can change what has to be carried.

## Project's own license

HashCerebrum is licensed under **GNU AGPL-3.0-or-later** (full text in the
top-level [`LICENSE`](../LICENSE); SPDX `AGPL-3.0-or-later` declared in
`package.json` and `src-tauri/Cargo.toml`). AGPL is strong copyleft: anyone who
distributes a modified version, or who runs a modified version as a network
service, must release their corresponding source under the same license.

All bundled dependencies and assets are permissive (MIT / Apache-2.0 / BSD /
ISC / Zlib / OFL-1.1 / MPL-2.0 / CC0) and therefore compatible with AGPL-3.0, so
the project can be distributed under AGPL without conflict. (Note: AGPL-3.0 is
compatible with Apache-2.0 and GPLv3-compatible permissive licenses, not with
GPLv2-only code — none of which is present here.)

## Static assets

### `public/noise.svg`

An inline SVG containing an `<feTurbulence>` filter node that generates a tileable film-grain overlay. This file has no third-party origin — it was authored for this project and is in the public domain. No attribution required.

## Icons

All UI icons are hand-drawn stroke SVGs in [`src/ui/icons/index.tsx`](../src/ui/icons/index.tsx). No third-party icon set is bundled.

## Data dictionaries

[`src/core/topic/data/mesh-subset.json`](../src/core/topic/data/mesh-subset.json) — hand-curated MeSH-subset, not a redistribution of NLM's MeSH XML. MeSH is in the public domain regardless; this file does not republish NLM data, it maps a handful of biomedical terms to anatomical regions for the in-app classifier.

## Adding a new asset

1. Drop it under `public/` or a documented subdir.
2. Add a `LICENSE` (or `LICENSE.md`) next to it.
3. Add a section here covering: title, source, license name, link, audit date.
4. If the license is anything other than CC0 / MIT / Apache 2.0 / Unlicense, get sign-off before committing.
