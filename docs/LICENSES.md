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

UI fonts are loaded at runtime from Google Fonts (no binaries bundled in `dist/`). The `index.html` `<link>` tag fetches them on first load; they are not vendored into the repository.

| Family | Google Fonts page | License |
|---|---|---|
| Source Serif 4 | fonts.google.com/specimen/Source+Serif+4 | SIL Open Font License 1.1 |
| Source Sans 3 | fonts.google.com/specimen/Source+Sans+3 | SIL Open Font License 1.1 |
| IBM Plex Mono | fonts.google.com/specimen/IBM+Plex+Mono | SIL Open Font License 1.1 |

The SIL OFL permits use in applications without restriction. No attribution is legally required in the UI, but the font families are credited here as good practice.

If the app is ever shipped for fully offline use (no network access), the font files must be vendored under `public/fonts/` and a copy of the OFL placed alongside them.

### `public/fonts/DejaVuSerif.ttf`, `public/fonts/DejaVuSerif-Bold.ttf`

- **Title:** DejaVu Serif (regular + bold)
- **Source:** DejaVu Fonts project, distributed via the `dejavu-fonts-ttf` npm package (v2.37.3).
- **License:** Bitstream Vera Fonts Copyright + Arev Fonts Copyright (permissive; allows redistribution and embedding). Full text vendored at [`public/fonts/LICENSE.txt`](../public/fonts/LICENSE.txt).
- **Usage:** Embedded into jsPDF at export time (`src/features/brain/export/paperPdf.ts`) so downloaded research-paper PDFs can render Greek letters and math/relation/arrow glyphs that the built-in WinAnsi "times" font cannot draw. Lazily fetched from `/fonts/` on first export; not part of the JS bundle. The font is vendored (not fetched from a CDN) so PDF export works fully offline.
- **Audit date:** 2026-05-31.

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
