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

1. **All outbound HTTP originates in Rust.** The renderer never calls
   `fetch()` to a medical or LLM host. (CSP allows the hosts only as a
   fail-safe for explicit user opt-in to direct-stream mode.)
2. **Every privileged action passes `security::guard::check`.**
   Categories: `Net`, `Keychain`, `Fs`, `Llm`. Denials and approvals
   are both audited.
3. **Audit log is hash-chained.** Each entry hashes the previous entry's
   hash. `audit_log_verify` walks the chain and returns the first broken
   sequence number, or `null` if intact.
4. **API keys live in the OS keychain only.** Never in files (`.env` is
   in `.gitignore`), never logged, never crossed back into JS except at
   the moment of an LLM call (and then preferably only if the user opts
   into front-end direct streaming).
5. **CSP is strict.** No external `script-src`, no `'unsafe-inline'` on
   scripts. Style allows `'unsafe-inline'` for dynamic theme tokens only.
6. **`withGlobalTauri: false`.** No implicit `window.__TAURI__`. The
   renderer must import from `@tauri-apps/api/core`, which is
   bundle-introspectable.
7. **Capabilities are minimum.** `src-tauri/capabilities/default.json`
   grants only the permissions we actually use. Every entry is reviewed.

## Denylist / SSRF protection

`src-tauri/src/security/denylist.rs` blocks:
- Cloud metadata endpoints (169.254.169.254, metadata.google.internal,
  metadata.azure.com)
- All RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
- Link-local IPv6 (`fe80:`)
- ULA IPv6 (`fc00::/7`)

`localhost` and `127.0.0.1` are NOT denylisted — they are allowed via
`policy::ALLOWED_HOSTS` only for Ollama.

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
