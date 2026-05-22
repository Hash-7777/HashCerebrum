# Security Policy

For the threat model and architecture, see [docs/SECURITY.md](docs/SECURITY.md).

## Reporting a vulnerability

Please use GitHub Security Advisories for private vulnerability reports and include:
- Affected commit / version
- Reproduction steps
- Impact assessment

Do **not** open a public GitHub issue for a security report.

## Hard rules (enforced by tooling)

- **No secrets in the repo.** API keys, tokens, certificates, and private
  keys are blocked by `.githooks/pre-commit` and `.gitignore`. Provider API
  keys are entered in Settings and held in the renderer's per-app WebKit
  `localStorage`, isolated by the Tauri bundle identifier — never committed,
  never written to the audit log, never stored in the response cache.
- **No outbound HTTP from the renderer.** All external requests are
  initiated in Rust and gated through `security::guard::check`. See
  [docs/SECURITY.md](docs/SECURITY.md).
- **Hash-chained audit log.** Every privileged action is appended to a
  tamper-evident chain (`audit_log_verify` walks it).
- **Strict CSP, `withGlobalTauri: false`.** The renderer cannot reach
  into the runtime via `window.__TAURI__`; it must import the typed API.

## Pre-commit hook

The repo ships with a pre-commit hook at `.githooks/pre-commit` that
scans staged content for common secret shapes. Enable it once per clone:

```sh
git config core.hooksPath .githooks
```

If the hook flags a false positive, fix the content or — only if you
have read the diff line-by-line — bypass with `git commit --no-verify`.
Do not bypass habitually.
