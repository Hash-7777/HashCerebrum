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
- **On-device semantic memory.** The embedding model (MedEmbed-small) is bundled
  in the app and run in a Web Worker via transformers.js with
  `allowRemoteModels = false` — memory search is meaning-based but fully local,
  with no model download and no text leaving the machine.
- **User-controlled wipe.** Settings → *Reset all data* erases all projects,
  memory + embeddings, chats, research runs, and the source cache (settings and
  API keys are kept).
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
   `connect-src` is `'self' blob: ipc:` — `blob:` is required so pdf.js can read
   the in-memory PDF it rasterises for the in-app preview; a `blob:` URL is local
   in-memory data and cannot address the network, so the zero-external-egress
   property is unchanged (no external host is permitted). Production and
   development Tauri CSP entries carry the same script policy so dev-time
   injected script hashes do not remove the WebAssembly allowance.
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

**Private ranges are matched by parsing the host as an `IpAddr`, not by string
prefix.** A prior implementation prefix-matched the literal `"fd"` (intended for
IPv6 ULA `fd00::/8`), which made any public hostname beginning with `fd`
(`fda.gov`, `fdic.gov`) count as private — and, through the Ollama LAN exception
below, reachable. `is_private_lan` now returns true only for an actual private
IP (RFC1918 / CGNAT / `fc00::/7`); a non-IP hostname is never "private," so a
public FQDN can no longer masquerade as a LAN host. Regression-tested in
`denylist.rs`.

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

**Resolved-IP guarding (DNS rebinding).** Validating the hostname alone is not
sufficient: a hostname that passes the allowlist could resolve — or be
re-resolved by a poisoned or hostile DNS answer — to a loopback or LAN address,
reaching an internal service. `security/resolver.rs` closes this window. The
`GuardedResolver` is attached as reqwest's DNS resolver on both outbound clients
(`commands/net.rs` for medical sources, `commands/llm.rs` for providers), so it
performs the resolution itself, filters every returned address through
`denylist::is_internal_ip`, and hands reqwest only the vetted addresses. There is
a single resolution and the connection can only reach an address that was
approved, so no gap remains between the check and the connect.

If a public host resolves exclusively to internal addresses, the request is
refused rather than connected. The intentional local target is preserved:
`guard::host_may_use_private_ip` returns true for the Ollama loopback/LAN hosts,
and a private address is accepted only for those. Loopback, RFC1918, CGNAT, ULA,
link-local, and the cloud-metadata endpoint are covered for both IPv4 and IPv6;
regression-tested in `security/resolver.rs`.

## Logging hygiene

- Rust uses `tracing` with structured fields. Secrets must never be
  passed as a field — pass a redacted marker.
- `tracing-subscriber` defaults to `info`; raise per-module via
  `RUST_LOG` for debugging.
- `AppError`'s `Display` impl is what crosses IPC. It must not leak
  paths or secret material.
- URLs written to the audit log or surfaced in an error have their query
  string **and** `user:pass@` userinfo stripped, so credentials embedded in a
  URL can never ride along into a log line or an IPC error.

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
- **Bounded response bodies.** Every HTTP response is read with `read_body_capped`,
  which streams the body chunk-by-chunk and aborts past a 50 MB cap — so a reply
  with no `Content-Length` header cannot buffer unbounded into memory (DoS/OOM).
- **No panics on untrusted text.** Snippet truncation is character-based
  (`chars().take(n)`), never byte-slicing, so a multi-byte UTF-8 abstract cannot
  panic the fetch (the crate builds with `panic = "abort"`).

## Dependency posture

`npm audit` reports clean, and CI enforces that: `npm audit --audit-level=moderate`
fails the build on any moderate-or-higher advisory.

**Resolved advisory — `adm-zip`.** Three high advisories
([GHSA-xcpc-8h2w-3j85](https://github.com/advisories/GHSA-xcpc-8h2w-3j85), a
crafted ZIP triggering a 4 GB allocation) reached the tree transitively through
`@huggingface/transformers` → `onnxruntime-node` → `adm-zip@0.5.x`. They are
resolved by an `overrides` entry in `package.json` pinning `adm-zip` to
`^0.6.0`, the patched line.

The override is used rather than `npm audit fix --force`, which resolves the
advisory by **downgrading** `@huggingface/transformers` from `4.2.0` to `3.8.1`
— trading a patched transitive dependency for an older embedding stack across
the semantic-memory, rerank, and NLI fact-check workers. Pinning the one
vulnerable package keeps both the fix and the current major.

The exposure was limited even before the pin: `@huggingface/transformers` is
imported only by the three web workers (`src/workers/embed.worker.ts`,
`rerank.worker.ts`, `nli.worker.ts`), which run in the renderer against the WASM
backend. `onnxruntime-node` is the Node-only native backend — never imported,
never bundled, and unreachable from a WebKit worker; the built `dist/` output
contains no reference to it or to `adm-zip`. That bounded the impact but is not
a reason to carry a known-vulnerable package, so it is pinned regardless.

**Resolved advisory — `protobufjs`.** A moderate advisory
([GHSA-j3f2-48v5-ccww](https://github.com/advisories/GHSA-j3f2-48v5-ccww), a
denial-of-service infinite loop in `.proto` option parsing, range `>=7.5.0
<=7.6.4`) reached the tree transitively through `@huggingface/transformers` →
`onnxruntime-web` → `protobufjs@7.6.4`. It is resolved by an `overrides` entry in
`package.json` pinning `protobufjs` to `^7.6.5`, the patched line;
`onnxruntime-web` requires `^7.2.4`, so the pin is semver-compatible and needs no
`--force`.

The realistic exposure was low even before the pin: `protobufjs` is used by
`onnxruntime-web` (the WASM backend the three workers run) only to parse the ONNX
model graph, and the sole model parsed is the app's own **bundled, trusted**
MedEmbed file — never an attacker-supplied `.proto`. The advisory is still
patched regardless, because carrying a known-vulnerable transitive dependency is
not acceptable and CI blocks it.

When bumping `@huggingface/transformers`, re-check whether these overrides are
still needed: once its `onnxruntime-node` requires a patched `adm-zip` and its
`onnxruntime-web` a patched `protobufjs` directly, drop the entries rather than
leaving pins that silently constrain the tree.

## Adding a new permission

Every addition to `capabilities/default.json` requires:
1. A comment in the same commit explaining why
2. Verification that no narrower permission solves the problem
3. An entry in the changelog
