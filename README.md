<div align="center">

# HashCerebrum

**A privacy-first desktop medical-research agent — built around a 3D anatomical brain.**

Ask a clinical question; a boss agent routes it, a swarm of medical specialists
fetches source-grounded evidence from guarded biomedical databases, and the app
synthesizes a fully cited answer — or a typeset, publication-grade research paper.

[![License: MIT](https://img.shields.io/badge/license-MIT-3dd1bf)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-backend-DEA584?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Platform](https://img.shields.io/badge/platform-macOS-111?logo=apple&logoColor=white)](#getting-started)
[![Version](https://img.shields.io/badge/version-0.1.0-blue)](package.json)

</div>

---

## Overview

HashCerebrum is a Tauri v2 desktop application for source-grounded clinical
literature work. Every external request — medical databases and LLM providers —
is mediated; nothing the user reads is invented without a traceable source. The
workspace is a real-time 3D anatomical brain whose regions light up as agents
and topics become active.

The app is offline-capable by design: the embedded typesetting engine, the
response cache, and the audit log all run locally, and the renderer never
reaches a provider host directly.

## Highlights

- **Boss-swarm research** — one boss agent routes each message: plain questions
  get a fast chat reply, research questions are delegated to topic specialists
  that fetch guarded evidence and return a citation-backed synthesis.
- **Guarded medical sources** — PubMed, Europe PMC, OpenAlex,
  ClinicalTrials.gov, openFDA, and RxNorm, fetched from Rust behind a host
  allowlist, a per-host rate limiter, and a SQLite response cache.
- **Publication-grade papers** — research papers are drafted section by section
  into a strict, validated manuscript structure and typeset to PDF by an
  embedded Typst engine, with cited-only Vancouver references and a choice of
  journal styles. jsPDF is the offline fallback.
- **Inferential statistics engine** — attach a CSV/TSV dataset and the app
  computes the statistics itself, in code: descriptive summaries, t-tests,
  ANOVA, Mann–Whitney, correlation, chi-square and Fisher's exact tests,
  odds/risk ratios, Mantel–Haenszel subgroup analysis with a forest plot, and
  Kaplan–Meier, log-rank, and Cox proportional-hazards survival analysis. The
  language model narrates the results; it never fabricates a number.
- **Per-project memory** — every research run's evidence and answer is saved
  into a per-project knowledge store and visualized as a brain-shaped memory
  diagram of linked findings.
- **Hash-chained audit log** — an append-only SQLite log of mediated actions,
  verifiable from Settings.

## Modes

| Mode | Shortcut | What it does |
| --- | --- | --- |
| **Brain** | ⌘1 | The research workspace: chat with the boss agent beside a live 3D anatomical brain whose regions light per active agent and detected topic. |
| **Resources** | ⌘2 | Saved papers and collections with tags, notes, search, and Markdown / BibTeX / CSL-JSON export. |
| **Memory** | ⌘3 | The active project's saved research memory — searchable evidence and answers, viewable as a list or a brain-shaped relatedness diagram. |

The mode registry is capped at five entries at compile time
(`src/config/modes.ts`).

## The agent swarm

A six-slot roster — one boss and five topic specialists — enforced as a
fixed-length tuple at compile time (`src/config/agents.ts`).

| Agent | Role |
| --- | --- |
| **Boss** | Routes every message, delegates research, and synthesizes one cited answer. |
| **Pharmacology** | Drugs, dosing, interactions, adverse effects, drug safety. |
| **Clinical trials** | Registered trials, study cohorts, and trial outcomes. |
| **Literature & evidence** | Peer-reviewed literature, systematic reviews, evidence synthesis. |
| **Dentistry** | Oral health, dental conditions, and dental-treatment evidence. |
| **Public health** | Epidemiology, prevention, vaccination, population health. |

Each agent can be assigned its own model in Settings, and a provider failover
chain keeps a run alive when a provider is rate-limited or out of credit.

## Architecture

```
React renderer  ──IPC──▶  Rust backend  ──guard──▶  medical sources
   (UI, 3D brain,            (host allowlist,         (PubMed, Europe PMC,
    agents, stats)            rate limiter,            OpenAlex, ctgov,
                              SQLite cache,            openFDA, RxNorm)
                              audit log, Typst)
```

- The renderer never calls a medical-source host directly — every such request
  is a Rust command behind the audited guard.
- PDF typesetting runs in-process in Rust via an embedded Typst engine; no
  sidecar binary and no network access are involved.
- All UI state lives in Zustand stores and a typed EventBus — no globals.

| Layer | Technology |
| --- | --- |
| Desktop shell | Tauri v2 |
| Backend | Rust — tokio, reqwest, rusqlite, embedded Typst (`typst` / `typst-pdf`) |
| Frontend | Vite 6, React 18, TypeScript (strict mode) |
| 3D | React Three Fiber, three.js, drei, postprocessing |
| State | Zustand stores, typed EventBus |
| PDF | Embedded Typst engine (primary), jsPDF (fallback) |

## Getting started

Requires **Node ≥ 20** and the **Rust toolchain** (for the desktop build).

```sh
npm install

npm run dev           # desktop dev app (Tauri, hot reload)
npm run dev:web       # browser-only Vite with a mock platform
npm run build         # production macOS .app
npm run build:dmg     # macOS .dmg
npm run build:web     # frontend bundle only (typecheck + Vite build)

npm test              # Vitest
npm run typecheck     # tsc — app + node project configs
```

Tauri dev runs a local Vite server for hot reload; packaged `.app` builds load
compiled files from `dist` and use no localhost.

### Provider keys

Provider API keys are entered in Settings and stored in renderer `localStorage`
as a single JSON bundle. Tauri's WebKit data directory is keyed by the bundle
identifier, so keys survive every rebuild and signed update without an OS
keychain prompt. Keys are never written to the repository, the audit log, or the
source cache.

### 3D model

The bundled anatomical brain GLB lives under `public/models/brain/` (CC0-1.0).
To swap it, drop a new GLB at the path declared in
`src/features/brain/data/region-map.json`, run `npm run validate:brain-model`
to confirm the mesh node names, and rebind regions — no code change required.
In a web dev build only, `http://localhost:1420/?dev=bindings` opens the region
binding editor.

## Project structure

```
src/
  config/            compile-time caps — modes, agents, constants
  core/              stores, EventBus, LLM provider registry, tools
  features/
    brain/           3D brain canvas, agent swarm, manuscript + stats engine
    memory/          per-project RAG memory + brain-shaped diagram
    resources/       saved-paper library
  platform/          Tauri / browser platform abstraction
src-tauri/           Rust backend — commands, guard, cache, audit, Typst
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security](docs/SECURITY.md)
- [Agents](docs/AGENTS.md)
- [Licenses](docs/LICENSES.md)
- [Remaining work](REMAINING_WORK.md)

## License

Released under the [MIT License](LICENSE) — © 2026 Seif Hashish.
Bundled third-party assets keep their own licenses; see
[docs/LICENSES.md](docs/LICENSES.md).
