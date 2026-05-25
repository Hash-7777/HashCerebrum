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

`localhost` and `127.0.0.1` are NOT denylisted — they are allowed via
`policy::ALLOWED_HOSTS`, and only on the Ollama port, for local models.

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

## Adding a new permission

Every addition to `capabilities/default.json` requires:
1. A comment in the same commit explaining why
2. Verification that no narrower permission solves the problem
3. An entry in the changelog
