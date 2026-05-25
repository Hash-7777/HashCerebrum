<div align="center">

<img width="200" height="200" alt="Sketches" style="border-radius: 500px;" src="https://github.com/user-attachments/assets/1d7fabb4-b697-4ca1-8a2c-b4ceac2aa7ae">

<div align="center">

# HashCerebrum

### AI medical research agent with a live 3D anatomical brain

Ask a clinical question. A boss agent routes it to topic specialists, each agent fetches source-grounded evidence from real biomedical databases, and the app either answers with inline citations or produces a complete, typeset, publication-grade research paper — all without the model inventing a single fact it cannot prove.

[![License: MIT](https://img.shields.io/badge/license-MIT-3dd1bf?style=flat-square)](LICENSE)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust backend](https://img.shields.io/badge/Rust-backend-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Platform: macOS](https://img.shields.io/badge/macOS-desktop-111?style=flat-square&logo=apple&logoColor=white)](#getting-started)

</div>

---
<img width="600" height="425" alt="Screenshot 2026-05-25 at 9 55 39 AM" src="https://github.com/user-attachments/assets/fb51d7aa-df65-4d18-bdac-e4d5cc9754be" />

## What makes this different

Most AI research tools either hallucinate citations or just wrap a chat model. HashCerebrum is built around a different constraint: **the model is not allowed to write a claim it cannot source**.

Every research turn follows a strict pipeline:

1. Seven medical databases are queried in parallel — PubMed, Europe PMC, OpenAlex, ClinicalTrials.gov, openFDA, RxNorm, Semantic Scholar
2. Retrieved records are extracted into a structured evidence table with study design, population, outcomes, and effect values
3. A claim ledger maps each finding to a source marker and grades its evidence strength
4. The manuscript compiler writes from approved ledger entries only — models may not reference `[S#]` markers they did not receive
5. A validation gate blocks export unless citations resolve, statistics are source-backed, sections meet depth minimums, and inline citations agree with the reference list

The result is a paper where every sentence has a chain of custody back to a real publication.

---

## The 3D workspace

The research workspace is a real-time 3D anatomical brain model (CC0-1.0, Science Museum). Each of the eight agents is bound to a specific brain region. As the swarm works, the corresponding regions pulse with a base glow blended against topic-detection accent colours — so you can watch the brain *think*.

| Agent | Brain region | Domain |
|---|---|---|
| Boss (The Cerebrum) | Frontal lobe | Routes questions, delegates, synthesizes |
| Literature & Evidence | Hippocampus | PubMed · Europe PMC · OpenAlex · Semantic Scholar |
| Clinical Trials | Parietal lobe | ClinicalTrials.gov — cohorts, designs, outcomes |
| Statistics & Data | Thalamus | Effect sizes · CIs · sample sizes · p-values |
| Pharmacology | Basal ganglia | RxNorm · openFDA — drugs, dosing, adverse effects |
| Drug Interactions | Amygdala | Drug-drug interactions · contraindications |
| Public Health | Occipital lobe | Epidemiology · prevention · vaccination |
| Dentistry | Temporal lobe | Oral health · dental treatment evidence |

The roster and the region map are compile-time constants — the type system rejects a ninth agent.

---

## Four modes

| Mode | Key | Description |
|---|---|---|
| **Brain** | `⌘1` | Research workspace — boss-swarm chat alongside a live 3D brain |
| **Resources** | `⌘2` | Saved paper library |
| **Memory** | `⌘3` | Per-project knowledge store — evidence, answers, and a brain-shaped relatedness diagram |
| **Peer Review** | `⌘4` | Upload any paper or send a Brain manuscript to a 5-agent critique swarm with a live document editor |

The mode registry is a typed tuple capped at five entries (`src/config/modes.ts`) — adding a sixth is a compile error.

---

## Peer review and document editing

Drop any PDF or send a Brain-generated manuscript to Peer Review mode. A swarm of five specialist agents runs in parallel:

- **Orchestrator** — overall score 1–10, strengths, weaknesses, methodology, statistics, conclusions, publish-readiness
- **Grammar** — spelling, clarity, academic style
- **Originality** — repetition, unsupported claims, attribution gaps
- **Vocabulary** — overused words, precision improvements, informal-to-academic replacements
- **Statistics** — methods, reporting completeness, sample-size/power, interpretation

After the review, **Fix Problems** opens a live `contenteditable` document editor. Each agent's suggestions are mapped back to exact passages in the text and highlighted with colour-coded marks. Every suggestion shows a before/after diff with **Accept**, **Skip**, and **Get Fix** buttons. Every accepted change is undoable.

---

## Security architecture

The renderer never makes an outbound HTTP request. Every call — medical databases and LLM providers alike — is a Tauri IPC call into Rust. Rust then runs the request through a layered guard:

```
Renderer  ─IPC─▶  security::guard::check()
                    ├── denylist  (cloud-metadata, RFC1918, link-local IPv6)
                    ├── allowlist (ALLOWED_HOSTS — 18 approved hosts)
                    ├── rate limiter (per-host token bucket)
                    └── audit log (hash-chained, SQLite, verifiable)
                  ─────▶  reqwest  ─────▶  external host
```

| Guarantee | Implementation |
|---|---|
| No renderer-to-internet HTTP | CSP `connect-src 'self'`; all external calls are Tauri commands |
| SSRF protection | RFC1918 + cloud-metadata denylist checked before allowlist |
| LLM header injection prevention | Rust-side allowlist — only `content-type`, `authorization`, `x-api-key`, `http-referer`, `x-title`, `anthropic-*`, `openai-*` |
| Tamper-evident audit trail | SHA-256 hash chain; each entry commits `seq \| prev_hash \| ts \| category \| subject \| action \| data_hash` |
| API keys never logged | Headers are forwarded to reqwest, never written to the audit log or cache |
| Path traversal + TOCTOU | `symlink_metadata → canonicalize → same_file` check; hardlinks rejected |
| PDF magic-byte validation | `%PDF` header check before `lopdf` parser is invoked |

The audit log is readable and verifiable from Settings → Audit log.

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust + WebKit) |
| Rust backend | tokio · reqwest (rustls) · rusqlite · lopdf · typst-as-lib · typst-pdf |
| Frontend | Vite 8 · React 18 · TypeScript 5 (strict + `noUncheckedIndexedAccess`) |
| 3D | React Three Fiber · three.js r184 · drei · @react-three/postprocessing |
| State | Zustand 5 · typed EventBus |
| PDF typesetting | Embedded Typst engine (primary, fully offline) · jsPDF (fallback) |
| Testing | Vitest (170 tests) |

The Typst compiler runs in-process in Rust — no sidecar, no network, no font downloads. All bundled fonts ship inside the binary via `typst-assets`.

---

## Getting started

**Prerequisites:** Node ≥ 20 and the [Rust toolchain](https://rustup.rs).

```sh
# Install dependencies
npm install

# Desktop development (hot reload — Tauri + Vite)
npm run dev

# Browser-only development (no Rust required — mock platform)
npm run dev:web

# Production build
npm run build          # macOS .app
npm run build:dmg      # macOS .dmg

# Checks
npm test               # Vitest — 170 unit tests
npm run typecheck      # tsc strict — app + node configs
```

### Adding an LLM provider

Open **Settings** (gear icon), find the provider row, paste your API key, and click Save. Supported providers:

`OpenAI` · `Anthropic` · `Google Gemini` · `Groq` · `OpenRouter` · `Mistral` · `DeepSeek` · `Moonshot` · `Cerebras` · `SambaNova` · `NVIDIA` · `Ollama (local)`

Keys are stored in renderer `localStorage`, isolated per-app by the WebKit bundle identifier. They are never committed, never written to the audit log, and never stored in the response cache.

### Running a research turn

1. Open **Brain** mode (`⌘1`)
2. Ask a clinical question — "What is the evidence for metformin in PCOS?"
3. Watch the boss route the question; specialists fetch evidence; the brain lights up
4. For a full paper, start with "write a paper on..." — the paper pipeline runs automatically

---

## Codebase map

```
src/
  config/          compile-time caps — modes (≤5), agents (≤8), constants
  core/
    bus/           typed EventBus
    llm/           provider registry, model catalog, streaming
    store/         Zustand stores — brain, agents, projects, runs, memory
    tools/         ToolRegistry — medical, stat, memory tools
  features/
    brain/         3D canvas, swarm runner, paper pipeline, manuscript editor
    memory/        per-project RAG store + TF-IDF postings + brain diagram
    peer_review/   review swarm, document editor, report PDF export
    resources/     saved-paper library
  platform/
    tauri/         Tauri IPC bindings (the ONLY caller of invoke())
    browser/       mock implementation for browser dev
  ui/              shell, icons, shared components

src-tauri/
  src/
    commands/      IPC surface — llm, medical, pdf, audit, cache, keychain
    security/      guard, denylist, policy, allowlist
    audit/         hash-chain + SQLite store + verify
    cache/         SQLite response cache
    ratelimit/     per-host token bucket
    crypto/        SHA-256 helpers
```

---

## How the paper pipeline prevents hallucination

```
User prompt
    │
    ▼
detectPaperRequest()  ──no──▶  normal chat answer
    │ yes
    ▼
Parallel evidence fetch  (PubMed · PMC · OpenAlex · ClinicalTrials · openFDA · RxNorm)
    │
    ▼
extractEvidenceFromRecords()  →  structured rows: [design, population, exposure,
                                  comparator, outcomes, n, effect, limitations, trust]
    │
    ▼
buildClaimLedger()  →  section-targeted claims with [S#] source markers
    │                   and evidence-strength grades (RCT > cohort > case report)
    ▼
buildPaperBlueprint()  →  section plan with required claims, figures, tables
    │
    ▼
compileManuscriptFromLedger()  →  model writes ONLY from approved [S#] entries
    │                              no invented statistics, no hallucinated trials
    ▼
validatePaperPackage()  →  BLOCKS export if:
    │                       · sections below word minimum
    │                       · inline citations disagree with reference list
    │                       · clinical results section has no source-backed findings
    │                       · statistical claims are unsupported
    │                       · abstract overstates the body
    ▼
buildPublicationArtifact()  →  manuscript + Vancouver references + evidence table
                                + claim ledger + source-yield stats + QA blockers
    │
    ▼
Typst PDF render  (embedded, offline, no fonts downloaded)
```

Missing effect sizes produce an honest warning and source-yield/evidence-strength statistics — not fabricated meta-analysis results.

---

## Documentation

| Document | Contents |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layer diagram, data-flow walkthrough, guardrails |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, invariants, SSRF denylist, logging hygiene |
| [docs/AGENTS.md](docs/AGENTS.md) | Full agent roster, lifecycle, system-prompt discipline |
| [docs/LICENSES.md](docs/LICENSES.md) | Third-party asset and dependency licenses |

---

## License

[MIT](LICENSE) — © 2026 Seif Hashish.  
Bundled third-party assets retain their own licenses — see [docs/LICENSES.md](docs/LICENSES.md).
