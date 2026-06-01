# Security

## Threat model

HashCerebrum is a single-user local desktop app. The threats we defend against:

1. **Compromised renderer** — a malicious page/extension/CSP bypass attempts
   to exfiltrate data or call privileged operations.
2. **Compromised tool output** — a medical API returns malicious payload
   intended to trigger downstream code execution.
3. **Tampering with audit history** — a local attacker (other process)
   modifies the audit log to hide their actions.
4. **Key leakage** — API keys end up in logs, files, or memory dumps.

Out of scope (today): physical access, kernel compromise, supply-chain
attacks on dependencies.

## Data locality & privacy

HashCerebrum is a single-user, local-first app with no server component, so
privacy is a property of the architecture rather than a policy:

- **Everything is on-device.** Projects, chat history, saved findings (the RAG
  memory store), the response cache, the audit log, and provider API keys are
  all held in local storage (renderer `localStorage` and local SQLite in the
  app data dir). Nothing is uploaded, and there is no account, cloud sync, or
  remote backup.
- **No telemetry.** There is no analytics, crash-reporting, or usage-tracking
  code in the project. The host allowlist (`security::policy::ALLOWED_HOSTS`)
  is the exhaustive list of destinations the app can contact; it contains no
  analytics or first-party endpoint.
- **Two egress classes, both auditable.** (1) Trusted public biomedical
  databases (PubMed/NLM, Europe PMC, OpenAlex, ClinicalTrials.gov, openFDA,
  RxNorm, Semantic Scholar) receive a search query and no personal data.
  (2) The one LLM provider the user configures receives the prompt (question +
  retrieved evidence). Every request is hash-chain audited.
- **Offline-capable.** With a local Ollama model the app makes zero external
  network calls; all reasoning stays on the device.
- **Honest limit.** A cloud LLM provider receives the prompt text under its own
  terms — the single path off-device. This is disclosed in `SECURITY.md` and
  the README, and is avoidable by using Ollama.

## Invariants

1. **All external HTTP originates in Rust.** The renderer never calls
   `fetch()` to a medical source or an LLM provider. Medical fetches and
   LLM calls alike (`llm_http_get` / `llm_http_post` / `llm_chat_stream`)
   run through Rust, behind the same guard, rate limiter, and audit path.
   The renderer's CSP declares no external `connect-src` host at all.
2. **Every privileged action passes `security::guard::check`.**
   Categories: `Net`, `Keychain`, `Fs`, `Llm`. Denials and approvals
   are both audited.
3. **Audit log is hash-chained.** Each entry hashes the previous entry's
   hash. `audit_log_verify` walks the chain and returns the first broken
   sequence number, or `null` if intact.
4. **API keys stay in the renderer key store.** Provider keys are held in
   the renderer's per-app WebKit `localStorage`, isolated by the Tauri
   bundle identifier. They are never committed (`.env` is in `.gitignore`),
   never written to the audit log, and never stored in model metadata or
   the response cache. A key is read only at the moment a provider call is
   made, then passed to the Rust proxy inside request headers — which are
   never logged. Trade-off: this avoids an OS-keychain unlock prompt on
   every launch, at the cost of at-rest encryption. An opt-in OS-keychain
   path is implemented in `commands/keychain.rs`.
5. **CSP is strict.** No external `script-src`, no `'unsafe-inline'` on
   scripts, and no broad `'unsafe-eval'`. The only script relaxation is
   `'wasm-unsafe-eval'`, which permits WebAssembly compilation needed by
   WebKit/PDF rendering paths without allowing general JavaScript string
   evaluation. Style allows `'unsafe-inline'` for dynamic theme tokens only.
   Production and development Tauri CSP entries carry the same script policy
   so dev-time injected script hashes do not remove the WebAssembly allowance.
6. **`withGlobalTauri: false`.** No implicit `window.__TAURI__`. The
   renderer must import from `@tauri-apps/api/core`, which is
   bundle-introspectable.
7. **Capabilities are minimum.** `src-tauri/capabilities/default.json`
   grants only the permissions we actually use. Every entry is reviewed.

## Denylist / SSRF protection

`src-tauri/src/security/denylist.rs` blocks, before the allowlist is even
consulted:
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal,
  metadata.azure.com) and `0.0.0.0`
- All RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
- CGNAT / shared address space (100.64.0.0/10, RFC 6598)
- Link-local IPv6 (`fe80:`) and ULA IPv6 (`fc00::/7`)

`localhost`, `127.0.0.1`, and `::1` are NOT denylisted — they are allowed via
`policy::ALLOWED_HOSTS`, and only on the Ollama port, for local models. `::1`
(IPv6 loopback) is allowlisted because on a dual-stack host `localhost` can
resolve to `::1`, which `url::Host` renders in bracketless form.

**LAN Ollama exception.** The denylist is split into two tiers
(`security/denylist.rs`): *hard* blocks (cloud metadata, link-local `169.254`/
`fe80:`, `0.0.0.0`) and *private-LAN* ranges (RFC1918 / CGNAT / ULA). The general
path blocks both. The **`ollama` provider only** may additionally reach a
private-LAN host — an RFC1918/CGNAT/ULA address, a `*.local` mDNS name, or a bare
single-label hostname — via `guard::check_llm_net`, so a user can run Ollama on
another device on their own network. This is deliberately narrow: hard-blocked
targets and dotted public FQDNs are still refused on the ollama path, so it can
only ever reach local/LAN hosts and cannot be used to exfiltrate to the internet
or hit cloud metadata. Every non-Ollama caller (medical sources, all cloud LLMs)
keeps the strict allowlist with no private-range access.

Known limitation: the denylist matches host *strings*. An allowlisted
domain whose DNS resolves to an internal address is not re-checked at the
resolved-IP level. This is acceptable given the fixed set of government and
academic API hosts the app talks to, but it is a deliberate, documented gap.

## Logging hygiene

- Rust uses `tracing` with structured fields. Secrets must never be
  passed as a field — pass a redacted marker.
- `tracing-subscriber` defaults to `info`; raise per-module via
  `RUST_LOG` for debugging.
- `AppError`'s `Display` impl is what crosses IPC. It must not leak
  paths or secret material.

## Untrusted-content handling (model + tool output)

The app treats both LLM output and fetched medical records as untrusted:

- **SVG sanitisation.** Before the dangerous-URL scan, HTML entities are decoded
  and whitespace stripped (`commands/manuscript.rs`), so an obfuscated
  `java&#115;cript:` payload cannot slip past the scanner. Typst-bound headings
  also strip markup metacharacters (`[ ] ~`) so model text cannot inject markup.
- **Prompt-injection / meta-question routing.** Queries that try to extract the
  system prompt, jailbreak, or introspect the app (`isMetaOrAppQuestion`,
  `META_QUESTION_RX`) are routed to a plain chat answer — they never enter the
  research/manuscript pipeline and are never persisted to project memory.
- **Fabricated-evidence guards.** The manuscript compiler forbids inventing
  primary studies, drops unresolved `[S#]` citations, and scans the abstract for
  prompt leakage before an artifact is built.
- **Editor paste hardening.** The Peer Review document editor strips pasted
  rich text to `text/plain`, so injected DOM cannot land in undo snapshots.

## Backend robustness invariants

These are availability/integrity properties, not just hardening:

- **Graceful HTTP client.** `http_client()` returns an `Option`; a TLS/builder
  failure degrades to a clear error instead of panicking the command.
- **Audit-chain corruption propagates.** A broken/forged chain surfaces as an
  error from the read path rather than being silently skipped, so tampering is
  visible rather than hidden.
- **Bounded reads + cache eviction.** Audit reads are bounded (`read_recent`);
  the response cache evicts oldest rows past `MAX_CACHE_ROWS` (2000) so a
  long-running install cannot grow the SQLite cache without limit.

## Adding a new permission

Every addition to `capabilities/default.json` requires:
1. A comment in the same commit explaining why
2. Verification that no narrower permission solves the problem
3. An entry in the changelog
