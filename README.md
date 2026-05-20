# HashCerebrum

Medical research agent desktop app for source-grounded clinical literature
work. A 3D anatomical brain is the workspace: anatomical regions light up as a
streaming answer touches the topics they map to, and an agent swarm fetches and
synthesizes evidence from guarded medical sources.

## Stack

- **Frontend:** Vite + React 18 + TypeScript (strict) + React Three Fiber (Three.js)
- **State:** Zustand stores + typed EventBus (no globals)
- **Backend:** Tauri v2 + Rust (tokio + reqwest + rusqlite)
- **Audit:** hash-chained SQLite append-only log, verifiable from Settings
- **Window state:** position and size restored across launches

## What it does

- **Brain mode** — chat against the brain. `Auto` routes biomedical prompts
  through an agentic evidence pipeline, `Chat` forces plain conversation,
  `Research` forces the source-backed pipeline. Anatomical regions glow live as
  a curated 1000-term MeSH-subset classifier tags the streaming text.
- **Resources mode** — saved evidence hub: collections, per-card tags and
  notes, fuzzy search, and Markdown / BibTeX / CSL-JSON export.
- **Agent swarm** — six bounded agents (Librarian, Trialist, Pharmacologist,
  Synthesizer, Citation, Critic) with fixed tool permissions.
- **Guarded sources** — PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov,
  openFDA, and RxNorm fetched from Rust behind a host allowlist, per-host rate
  limiter, and SQLite response cache.

## Provider keys

Provider API keys are entered in Settings and stored in renderer `localStorage`
as a single JSON bundle. Tauri's WebKit data directory is keyed by the bundle
identifier, not the binary signature, so keys survive every rebuild and signed
update without an OS keychain prompt. Keys are never written to the repository,
the audit log, or the source cache. LLM provider adapters currently stream
directly from the renderer; the medical-source HTTP path is Rust-only.

## Hard caps (compile-time)

- 5 modes max — `src/config/modes.ts` rejects a sixth (2 registered: Brain, Resources)
- 6 agents — `src/config/agents.ts` enforces the same tuple cap (all 6 in use)

## Run

```sh
npm install
npm run dev                # desktop dev app (Tauri)
npm run dev:web            # browser-only Vite with mock platform
npm run build              # production macOS .app
npm run build:app:debug    # debug .app bundle
npm run build:web          # production frontend bundle only
npm run build:dmg          # macOS .dmg
npm test                   # Vitest
npm run typecheck          # tsc, both project + node configs
npm run validate:brain-model   # list the GLB's mesh node names
```

Tauri dev uses a local Vite server internally for hot reload. Packaged `.app`
builds load compiled files from `dist` and do not use localhost.

### Dev tools

`npm run dev:web` then open `http://localhost:1420/?dev=bindings` for the
brain region binding editor — bind GLB mesh nodes to anatomical regions and
export an updated `region-map.json`. Dev builds only; never reachable in a
production build.

## 3D model

The bundled brain GLB lives at `public/models/brain/` under CC0-1.0; see
`public/models/brain/LICENSE.md` and [docs/LICENSES.md](docs/LICENSES.md). To
swap it: drop a new GLB at the path declared in
`src/features/brain/data/region-map.json`, run `npm run validate:brain-model`
to confirm node names, then update the bindings — no code change needed.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Agents](docs/AGENTS.md)
- [Remaining work](REMAINING_WORK.md)
