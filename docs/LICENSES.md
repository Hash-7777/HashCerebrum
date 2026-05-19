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

## Fonts

System fonts only — no bundled font files. The CSS declares Inter / Iowan Old Style / JetBrains Mono as preferences and falls back through `ui-sans-serif`, `Georgia`, `ui-monospace`. No font binary is shipped in `dist/`.

## Icons

All UI icons are hand-drawn stroke SVGs in [`src/ui/icons/index.tsx`](../src/ui/icons/index.tsx). No third-party icon set is bundled.

## Data dictionaries

[`src/core/topic/data/mesh-subset.json`](../src/core/topic/data/mesh-subset.json) — hand-curated MeSH-subset, not a redistribution of NLM's MeSH XML. MeSH is in the public domain regardless; this file does not republish NLM data, it maps a handful of biomedical terms to anatomical regions for the in-app classifier.

## Adding a new asset

1. Drop it under `public/` or a documented subdir.
2. Add a `LICENSE` (or `LICENSE.md`) next to it.
3. Add a section here covering: title, source, license name, link, audit date.
4. If the license is anything other than CC0 / MIT / Apache 2.0 / Unlicense, get sign-off before committing.
