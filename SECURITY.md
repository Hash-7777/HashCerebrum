# Security Policy

HashCerebrum is a single-user, local-first desktop application. It performs no outbound network request from the renderer, stores no user data on a remote server, and runs every privileged operation behind a Rust security guard. The full threat model, invariants, and SSRF/denylist design live in [docs/SECURITY.md](docs/SECURITY.md); this document is the **disclosure policy**.

We take security seriously and appreciate responsible disclosure. Thank you for helping keep HashCerebrum and its users safe.

## Data handling & privacy

HashCerebrum is built for a field where data privacy and source trust are non-negotiable. The privacy posture is an architectural guarantee, not a policy promise:

- **Local-first.** Projects, chat history, saved findings (memory), learning data (beliefs, knowledge graph, episodes, source reliability, learning queue, drift records), the evidence cache, the audit log, and your provider API keys all live in local storage on your device. There is no backend, no account, no cloud sync, and no telemetry, analytics, or crash-reporting SDK anywhere in the codebase.
- **The renderer has no network capability.** A strict CSP (`connect-src 'self' blob:`) means the web layer cannot make an outbound request — `blob:` covers only in-memory data (the in-app PDF preview) and cannot address the network. Only the Rust core can reach out, and only to a fixed host allowlist (`src-tauri/src/security/policy.rs`).
- **Egress is enumerable and audited.** The only destinations the app can reach are (1) trusted public biomedical databases — PubMed/NLM, Europe PMC, OpenAlex, ClinicalTrials.gov, openFDA, RxNorm, Semantic Scholar, GWAS Catalog (EBI), and ClinVar (NCBI) — which receive a query and no personal data; and (2) the single LLM provider you configure, which receives your prompt (question + retrieved evidence) under its own terms. Every request is recorded in a tamper-evident, hash-chained audit log readable from **Settings → Audit log**.
- **A fully-offline mode exists.** Configure a local **Ollama** model and the app makes no external network calls at all — questions, evidence, reasoning, and learning never leave the device. (Ollama may run on another device on your LAN; that path is narrowly allowed and still blocks public/cloud-metadata hosts.)
- **On-device semantic memory + learning.** The embedding model that powers meaning-based memory search is bundled and runs locally (no download, no egress). All learning data (beliefs, knowledge graph, consensus timelines, source reliability scores, episodic memory, learning queue, semantic drift) is computed and stored on-device.
- **One-click wipe.** Settings → *Reset all data* clears all projects, memory, learning data, chats, runs, and cache for a clean slate (settings and API keys are kept).

**One honest caveat:** when you choose a cloud LLM provider, the text of your prompt is transmitted to that provider and is governed by their privacy policy. That is the only path off your device. For zero egress, use Ollama.

## Supported versions

The project ships from `main`. Only the latest released version and the current `main` branch receive security fixes.

| Version | Supported |
|---|---|
| `main` (latest) | ✅ |
| `1.1.x` | ✅ |
| < `1.1.0` | ❌ |

## Reporting a vulnerability

**Please do not open a public issue, pull request, or discussion for a security report.** Public disclosure before a fix is available puts users at risk.

Report privately through **[GitHub Security Advisories](https://github.com/Hash-7777/HashCerebrum/security/advisories/new)** ("Report a vulnerability"). This opens a private channel between you and the maintainer and lets us collaborate on a fix and a coordinated release.

A good report includes:

- **Affected version / commit** — tag, release, or commit SHA.
- **Component** — e.g. Rust IPC command, security guard, CSP, audit log, PDF/manuscript pipeline, peer-review editor, learning store, agentic RAG pipeline.
- **Reproduction steps** — a minimal, reliable sequence; proof-of-concept code or a sample input file is ideal.
- **Impact** — what an attacker gains (data exposure, SSRF, code execution, audit tampering, key leakage, learning data poisoning, etc.).
- **Environment** — OS and version, app build, and any relevant configuration.

If you have a suggested fix, include it — but it is not required.

## What to expect

| Stage | Target |
|---|---|
| Acknowledge your report | within **48 hours** |
| Initial assessment & severity triage | within **5 business days** |
| Fix or mitigation plan | within **30 days** for confirmed issues |
| Coordinated public disclosure | after a fix ships, by mutual agreement |

These are good-faith targets for a solo-maintained project, not contractual guarantees. We will keep you updated as the investigation progresses and credit you in the advisory and release notes unless you ask to remain anonymous.

## Scope

**In scope** — the HashCerebrum application and repository, including:

- The Rust backend, IPC command surface, and `security::guard` (SSRF/denylist, allowlist, rate limiter, hash-chained audit log).
- The renderer, its Content-Security-Policy, and the `@tauri-apps` IPC bridge.
- The research, manuscript, and peer-review pipelines (prompt-injection, fabricated evidence, untrusted PDF/SVG/model output handling).
- The Smart Agentic RAG and learning pipeline (belief state, knowledge graph, episodic memory, learning queue, source reliability, semantic drift).
- Secret-handling: provider API-key storage, logging, and the response cache.
- The release/build configuration and bundled assets.

**Out of scope** — generally not eligible:

- Physical access to an unlocked machine, OS/kernel compromise, or a malicious local process running with the user's privileges (see the documented threat model and accepted trade-offs in [docs/SECURITY.md](docs/SECURITY.md)).
- Vulnerabilities in third-party LLM providers or medical-data APIs the app talks to (report those to the respective vendor).
- Supply-chain issues in upstream dependencies — please report upstream; we will update once a fixed version is released.
- Findings that require the user to paste an attacker-supplied API key or disable shipped security controls.
- Self-XSS, missing best-practice headers with no demonstrated impact, or automated-scanner output without a working proof of concept.
- Learning data poisoning that requires the user to deliberately import malicious PDFs or accept fabricated research findings.

If you are unsure whether something is in scope, report it privately and ask.

## Coordinated disclosure & safe harbor

We follow **coordinated disclosure**: please give us a reasonable window to release a fix before any public write-up, and we will work with you on timing and credit.

Security research conducted in good faith under this policy is welcome. We will not pursue or support legal action against researchers who:

- make a good-faith effort to avoid privacy violations, data destruction, and service disruption;
- only access or modify data they own or that is provided for testing;
- give us a reasonable time to remediate before public disclosure; and
- do not exploit a finding beyond what is necessary to prove it.

This is not a paid bug-bounty program; we offer recognition, not a monetary reward.

## Hard rules (enforced by tooling)

These invariants are enforced in the codebase and CI, not just documented:

- **No secrets in the repo.** API keys, tokens, certificates, and private keys are blocked by `.githooks/pre-commit` and `.gitignore`. Provider API keys are entered in Settings and held in the renderer's per-app WebKit `localStorage`, isolated by the Tauri bundle identifier — never committed, never written to the audit log, never stored in the response cache.
- **No outbound HTTP from the renderer.** All external requests are initiated in Rust and gated through `security::guard::check` (SSRF denylist → host allowlist → rate limiter → audit). See [docs/SECURITY.md](docs/SECURITY.md).
- **Hash-chained audit log.** Every privileged action is appended to a tamper-evident SHA-256 chain; `audit_log_verify` walks it and corruption is surfaced, not silently skipped.
- **Strict CSP, `withGlobalTauri: false`.** The renderer cannot reach the runtime via `window.__TAURI__`; it must import the typed API. No external `script-src`/`connect-src`, no `'unsafe-eval'` (only `'wasm-unsafe-eval'`).
- **Learning data is local-only.** All belief states, knowledge graphs, consensus timelines, source reliability scores, episodic memories, learning queues, and semantic drift records are computed and stored on-device. No learning data is transmitted to any external service.

## Pre-commit hook

The repo ships a secret-scanning pre-commit hook at `.githooks/pre-commit`.
Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

If the hook flags a false positive, fix the content or — only after reading the diff line by line — bypass with `git commit --no-verify`. Do not bypass habitually.
