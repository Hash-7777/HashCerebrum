<div align="center">

<img width="200" height="200" alt="HashCerebrum" style="border-radius: 500px;" src="https://github.com/user-attachments/assets/1d7fabb4-b697-4ca1-8a2c-b4ceac2aa7ae">

# HashCerebrum

### A private, local-first agentic desktop app for medical research

[![Website](https://img.shields.io/badge/website-hashcerebrum.com-14a89a?style=flat-square)](https://hashcerebrum.com)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-333333?style=flat-square)](LICENSE)
[![Local-first](https://img.shields.io/badge/local--first-on--device-333333?style=flat-square)](#privacy--data-locality)
[![No telemetry](https://img.shields.io/badge/telemetry-none-333333?style=flat-square)](#privacy--data-locality)
[![Tauri v2](https://img.shields.io/badge/Tauri-v2-24C8DB?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![React 18](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=white)](https://react.dev)
[![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust backend](https://img.shields.io/badge/Rust-backend-DEA584?style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Platform: macOS](https://img.shields.io/badge/macOS-desktop-333333?style=flat-square&logo=apple&logoColor=white)](#getting-started)

</div>

> **Built on [HashCortX](#lineage--built-on-hashcortx).** HashCerebrum is built
> using the author's earlier local-first agentic desktop app, **HashCortX**, as
> its building blocks — its multi-provider failover chain, guarded/audited
> network core, swarm + tool-registry orchestration, and the "Medical
> Lexi-Check" drug-interaction grader — then extends them for medicine with a
> hallucination-gated paper pipeline, on-device semantic memory, and a 3D
> anatomical workspace.

Your research stays on your machine. HashCerebrum is a **local-first desktop app** — no account, no sign-up, no cloud, no telemetry, nothing phones home. A boss agent routes your clinical question to topic specialists that fetch **source-grounded evidence from real, authoritative biomedical databases**, then answer with inline citations or compile a typeset research paper — all without the model inventing a single fact it cannot prove. The web layer cannot make a network call; every outbound request is gated, allowlisted, and recorded in a tamper-evident audit log you can read yourself. Use a local model (Ollama) and the app makes **zero external calls at all** — including the embedding model that powers memory, which is bundled and runs on-device.

---

## Why HashCerebrum

In medicine, two things matter more than anything else: **where your data goes** and **whether you can trust the source**. HashCerebrum is built around both.

**Private by architecture.** Everything you do — projects, saved findings, the evidence cache, the audit log, your API keys — lives in local storage on your own machine. There is no backend to leak, no account to breach, no analytics SDK, no "anonymous usage data." The web layer is sandboxed and **physically cannot reach the internet**; only the Rust core can, and only to a fixed, audited allowlist of destinations. Point it at a local Ollama model and your questions never leave the device.

**Sourced by construction.** The model is not allowed to write a claim it cannot prove. Every research turn follows a strict pipeline:

1. Authoritative biomedical databases are queried in parallel — **PubMed/NLM, Europe PMC, OpenAlex, ClinicalTrials.gov, openFDA, RxNorm, Semantic Scholar** (no scraped blogs, no synthetic corpora)
2. Retrieved records are extracted into a structured evidence table with study design, population, outcomes, and effect values
3. A claim ledger maps each finding to a source marker and grades its evidence strength
4. The manuscript compiler writes from approved ledger entries only — models may not reference `[S#]` markers they did not receive
5. A validation gate blocks export unless citations resolve, statistics are source-backed, sections meet depth minimums, and inline citations agree with the reference list

The result is an answer where **every sentence has a chain of custody back to a real publication** — and a clear record of exactly which databases were contacted to produce it.

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

## Modes

| Mode | Key | Description |
|---|---|---|
| **Brain** | `⌘1` | Research workspace — boss-swarm chat alongside a live 3D brain. Two composer toggles: **Memory** on/off (research from scratch) and **Brain Mini** (a lighter pipeline — fewer specialists, shorter sections, no rate-limit waiting — tuned for free models and small Ollama models) |
| **Memory** | `⌘2` | Semantic knowledge store — cited findings searched by meaning, plotted on a real **labelled 3-axis (PC1/PC2/PC3) vector map** with k-means clusters; a **Project / Library** scope toggle browses the whole cross-project corpus; one-click **Prune** |
| **Peer Review** | `⌘3` | Upload any paper or send a Brain manuscript to a 5-agent critique swarm with a live document editor — resilient on free-tier rate limits and always returns at least a partial review |
| **Drug Interactions** | `⌘4` | A focused clinical-pharmacology checker — grades each drug pair **A–X** (none → contraindicated) with mechanism, effect, and management, weighting authoritative drug-label sources |

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

On a low-quota or local model the review runs **serially with backoff** that honours the provider's own retry hint, sends each agent a **condensed view** of the manuscript (far fewer calls), and — if a provider is exhausted — degrades to a clearly-labelled **partial** review instead of failing outright.

---

## Drug Interactions — a graded clinical checker

The **Drug Interactions** mode is a focused interaction checker rather than the general research team. A single specialist gathers evidence and the report **grades every drug pair on the A–X scale** — A (none) · B (minor) · C (moderate) · D (major) · X (contraindicated) — as one card per pair with **Mechanism · Effect · Action · Evidence**, a critical-alerts summary, and a verify-with-a-clinician line. It biases toward the more serious grade when evidence is thin, treats **drug-label (openFDA) and RxNorm** records as authoritative, and cites `[S#]` throughout — it will not invent an interaction.

Its confirmed findings are saved to the shared memory (tagged `drug_interactions`) so ordinary Brain research benefits from them — but the checker itself only draws on its **own trusted interaction findings**, never the other modes' general research.

This grading model and the failover chain are adapted from patterns in the author's prior desktop app, **HashCortX** (see *Lineage* below).

---

## Semantic memory (private, on-device)

Every research run saves the findings it actually cited, and later research can
reuse them **across all your projects** — ranked to prefer the one you're in.
Retrieval works by **meaning, not keywords**: a small, medical-tuned embedding
model (**MedEmbed-small**, Apache-2.0) is **bundled in the app** and runs entirely
on-device in a Web Worker, so a search for "MI" finds a paper about "myocardial
infarction." Nothing is downloaded at runtime and no text leaves the machine.

- **A trusted, de-duplicated library** — the same paper is stored **once** across
  all projects (keyed by PMID → DOI → URL → title), and retrieval favours
  verifiable, higher-tier sources (a PubMed record with a PMID outranks an
  unidentified one). A **Project / Library** scope toggle browses the whole
  corpus — your own focused PubMed.
- **Hybrid, concept-aware retrieval** — semantic (vector) similarity fused with
  lexical search via Reciprocal Rank Fusion, weighted toward the active project,
  re-ranked by evidence strength + recency + source trust and de-duplicated (MMR).
  The semantic vector is built from your **original** query (not a synonym-expanded
  one) so meaning stays sharp, while the expansion still widens keyword recall.
- **Offline term normalisation** — a built-in brand↔generic / abbreviation
  dictionary (Tylenol↔acetaminophen, MI↔myocardial infarction, plus common
  Egyptian and international brands) widens each search, fully offline.
- **Real 3-axis vector map** — the Memory graph plots each finding by the PCA
  projection of its real embedding onto labelled **PC1 / PC2 / PC3** axes over a
  reference grid, colours nodes by genuine **k-means** clusters, and draws
  nearest-neighbour edges from real cosine similarity — a faithful picture of
  your knowledge, not a decorative layout.
- **Memory toggle** — flip memory off in the composer to research a topic from
  scratch on fresh sources only.

Embeddings are stored compactly (int8-quantised) with oldest-first eviction. A
**Reset all data** control in Settings wipes memory, chats, runs, and cache for a
clean slate (settings and API keys are kept).

---

## Privacy & data locality

HashCerebrum is designed so that **your data stays yours**. It is a single-user desktop app with no server component.

| What | Where it lives | Leaves your machine? |
|---|---|---|
| Projects, chat history, saved findings (memory) | Local app storage on your device | **Never** |
| Retrieved-evidence cache, audit log | Local SQLite in the app data dir | **Never** |
| Provider API keys | Renderer `localStorage`, isolated by the app's bundle identifier | **Never** committed, logged, or cached |
| Generated papers / PDFs | Written to your Downloads folder | Only if you export them |
| Your question + retrieved evidence | Sent **only** to the one LLM provider you configure | Yes — to that provider, unless you use a local model |

**The web layer cannot reach the internet.** A strict Content-Security-Policy (`connect-src 'self' blob:`, where `blob:` is in-memory data only and cannot address the network) means the UI has no network capability at all. Every outbound request is made by the Rust core, and only to a **fixed allowlist** of destinations:

- **Trusted medical data sources** — eutils/PubMed (NLM), Europe PMC (EBI), OpenAlex, ClinicalTrials.gov, openFDA, RxNorm (NLM), Semantic Scholar. These are public, authoritative biomedical databases; the app reads from them and sends no personal data.
- **The single LLM provider you choose** — your prompt (question + retrieved evidence) goes to that provider under their terms. Nothing else does.
- **Nowhere, if you go fully local** — configure **Ollama** as your model and the app makes **no external network calls whatsoever**: questions, evidence, and reasoning all stay on the device.

**No telemetry, no accounts, no tracking.** There is no analytics SDK, no crash reporter, no "anonymous usage" beacon, no sign-up, and no cloud sync anywhere in the codebase. Every network call the app *can* make is enumerated in the host allowlist (`src-tauri/src/security/policy.rs`) and recorded in a tamper-evident audit log you can open from **Settings → Audit log**.

> **Honest scope:** when you select a cloud LLM provider, the text of your prompt is transmitted to that provider and governed by their privacy policy — that is the one path off your device, and the app states it plainly. For zero egress, use a local Ollama model. HashCerebrum is a research aid, not a medical device, and does not provide clinical advice.

---

## Security architecture

The renderer never makes an outbound HTTP request. Every call — medical databases and LLM providers alike — is a Tauri IPC call into Rust. Rust then runs the request through a layered guard:

```
Renderer  ─IPC─▶  security::guard::check()
                    ├── denylist  (cloud-metadata, RFC1918, link-local + ULA IPv6)
                    ├── allowlist (ALLOWED_HOSTS — 25 approved hosts + loopback)
                    ├── rate limiter (per-host token bucket)
                    └── audit log (hash-chained, SQLite, verifiable)
                  ─────▶  reqwest  ─────▶  external host
```

The one deliberate exception: the **Ollama provider** may reach a **private-LAN**
host (RFC1918 / `*.local` / a bare hostname) so you can run Ollama on another
device on your network. Cloud-metadata, link-local, and public hosts stay blocked
even for Ollama, and every other caller keeps the strict allowlist.

| Guarantee | Implementation |
|---|---|
| No renderer-to-internet HTTP | CSP `connect-src 'self' blob:` (blob: is in-memory only — for the in-app PDF preview — and cannot reach the network); all external calls are Tauri commands |
| SSRF protection | Hosts are **parsed as IP addresses** and matched against real RFC1918 / CGNAT / IPv6-ULA ranges + a cloud-metadata denylist, checked before the allowlist — a public FQDN can never masquerade as a private host |
| Bounded response bodies | Every response is read with a streaming 50 MB cap, so a reply **without a `Content-Length` header** still cannot exhaust memory |
| LLM header injection prevention | Rust-side allowlist — only `content-type`, `authorization`, `x-api-key`, `http-referer`, `x-title`, `anthropic-*`, `openai-*` |
| Tamper-evident audit trail | SHA-256 hash chain; each entry commits `seq \| prev_hash \| ts \| category \| subject \| action \| data_hash` |
| API keys never logged | Headers are forwarded to reqwest, never written to the audit log or cache; URL `user:pass@` userinfo is stripped from every logged/error URL |
| Path traversal + TOCTOU | `symlink_metadata → canonicalize → same_file` check; hardlinks rejected |
| PDF magic-byte validation | `%PDF` header check before `lopdf` parser is invoked |
| Crash-safe parsing | Snippet truncation is character-based (no UTF-8 byte-slice panics) |

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
| PDF typesetting | Embedded Typst engine (primary, fully offline) · jsPDF + embedded DejaVu Unicode font (fallback) |
| PDF rendering | pdfjs-dist — uploaded papers rendered to canvas in Peer Review |
| Embeddings | transformers.js (ONNX/WASM) · bundled MedEmbed-small model · in-Worker, offline |
| LLM routing | 17 providers with tier-based failover; the swarm spreads its agents across **distinct providers** and failover prefers a fresh provider, so one key is never burned into rate limits (pin all to one key for a paid provider) |
| Testing | Vitest (362 tests) + `cargo test` (31 tests) |

The Typst compiler runs in-process in Rust — no sidecar, no network, no font downloads. All bundled fonts ship inside the binary via `typst-assets`.

---

## Getting started

**Prerequisites:** Node ≥ 20 and the [Rust toolchain](https://rustup.rs).

```sh
# Install dependencies. The embedding model is committed, so there's no model
# download or setup step. (On an offline/restricted machine, set
# ONNXRUNTIME_NODE_INSTALL=skip to skip onnxruntime-node's unused native binary —
# the app uses onnxruntime-web/WASM. CI sets this automatically.)
npm install

# Desktop development (hot reload — Tauri + Vite)
npm run dev

# Browser-only development (no Rust required — mock platform)
npm run dev:web

# Production build
npm run build          # macOS .app
npm run build:dmg      # macOS .dmg

# Checks
npm test               # Vitest — 362 unit tests
npm run typecheck      # tsc strict — app + node configs
npm run build:web      # tsc over app + tests, then Vite build
```

### Adding an LLM provider

Open **Settings** (gear icon), find the provider row, paste your API key, and click Save. Supported providers:

`OpenAI` · `Anthropic` · `Google Gemini` · `Groq` · `OpenRouter` · `Mistral` · `DeepSeek` · `Moonshot` · `Cerebras` · `SambaNova` · `NVIDIA` · `MiniMax` · `xAI (Grok)` · `Together AI` · `Fireworks AI` · `DeepInfra` · `Ollama (local)`

Keys are stored in renderer `localStorage`, isolated per-app by the WebKit bundle identifier. They are never committed, never written to the audit log, and never stored in the response cache.

> **For maximum privacy, choose `Ollama (local)`.** Your prompts are then served by a model running on your own machine and the app makes no external LLM call at all. With any cloud provider, the prompt (question + retrieved evidence) is sent to that provider under their terms — see [Privacy & data locality](#privacy--data-locality).

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
    rag/           semantic memory — embeddings, hybrid retrieval, vector store
    store/         Zustand stores — brain, agents, projects, runs, reset
    tools/         ToolRegistry — medical, stat, memory tools
  features/
    brain/         3D canvas, swarm runner, paper pipeline, manuscript editor
    memory/        memory UI — semantic search, 3D vector map (PCA), prune
    peer_review/   review swarm, document editor, report PDF export
    resources/     saved-paper library
  platform/
    tauri/         Tauri IPC bindings (the ONLY caller of invoke())
    browser/       mock implementation for browser dev
  workers/         embed.worker.ts — in-app embeddings (transformers.js, WASM)
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
Parallel evidence fetch  (PubMed · PMC · OpenAlex · ClinicalTrials · openFDA · RxNorm · Semantic Scholar)
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

## Lineage — built on HashCortX

HashCerebrum is built using **HashCortX** — the author's earlier local-first
agentic desktop app — as its building blocks. Several core patterns are carried
over and adapted for the medical domain:

- the **multi-provider failover chain** (tier-based candidate selection, provider
  cooldown, retriable/billing error classification) — ported and extended with
  cross-provider spreading;
- the **guarded, audited network core** (single Rust chokepoint, host allowlist,
  hash-chained audit log) hardened for SSRF;
- the **swarm + tool-registry** orchestration model; and
- the **Drug Interactions grader**, modelled on HashCortX's "Medical Lexi-Check"
  agent (A–X interaction grading with per-pair cards).

HashCerebrum then layers on what HashCortX did not have: a typeset,
hallucination-gated paper pipeline, on-device semantic memory with a real 3-axis
vector map, the 3D anatomical workspace, and a peer-review swarm.

---

## Disclaimer

> **HashCerebrum is for research and education only. It is not a medical device and carries no FDA, EMA, or equivalent regulatory approval. It is not intended to diagnose, treat, cure, or prevent any medical condition.**

| Topic | Terms |
|---|---|
| **Not a medical device** | For research and education only. No regulatory approval. Not intended to diagnose, treat, or prevent any condition. Not for users under 18. LLMs can hallucinate — always verify outputs independently. |
| **Consult a professional** | Never disregard professional medical advice or delay seeking it because of something you read or generated here. Always consult your physician, pharmacist, or qualified healthcare provider for questions about a medical condition, medication, or treatment. |
| **No warranties** | Provided "as is" without warranties of any kind. As open-source software it has not undergone professional clinical validation or heavy-load testing. Authors have no obligation to provide updates, support, or bug fixes. You are responsible for your own data backups. |
| **No liability** | To the fullest extent permitted by law, the authors are not liable for damages, wrong results, data-privacy issues, or data loss arising from your use. You agree to indemnify the authors from any claims arising from your use, modification, or distribution of the software. |
| **Data & third parties** | HashCerebrum is software, not a HIPAA-covered entity or GDPR controller. Your data stays on your device; you are responsible for its security. Retrieved evidence comes from public databases and LLM providers — we do not control, guarantee, or endorse their accuracy. References to drugs or treatments do not constitute endorsement. |
| **License** | GNU AGPL-3.0-or-later. You may use, modify, and distribute the software under those terms. You are responsible for any modifications you make. Third-party trademarks belong to their owners. Your generated manuscripts remain your intellectual property. |

By using HashCerebrum, you acknowledge these terms. If you do not agree, please do not use the software.

---

## License

[GNU AGPL-3.0-or-later](LICENSE) — © 2026 Seif Hashish.

HashCerebrum is free and open source. Under the AGPL, anyone who distributes a
modified version — or runs a modified version as a network service — must make
their corresponding source available under the same license.

Bundled third-party dependencies and assets retain their own (permissive)
licenses — see [docs/LICENSES.md](docs/LICENSES.md).
