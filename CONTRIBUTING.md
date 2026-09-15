# Contributing to HashCerebrum

Thanks for your interest in improving HashCerebrum. This is a solo-maintained,
local-first medical-research desktop app, and thoughtful contributions are
welcome — bug reports, fixes, documentation, and well-scoped features.

Please read this guide before opening an issue or pull request.

## Ground rules

HashCerebrum has a few invariants that contributions must not break:

- **Local-first, no backend.** No telemetry, analytics, crash-reporting SDKs,
  accounts, or cloud sync. Every outbound request goes directly from the user's
  device to the provider they chose, behind the Rust security guard. A change
  that phones home will not be merged.
- **Evidence over assertion.** The paper pipeline, claim ledger, and
  deterministic honesty pass exist so the model cannot state what it cannot
  cite. Keep these guarantees intact.
- **Determinism where it's promised.** Scores and extraction (association
  confidence, effect sizes, ranking priors) are computed in code, never by the
  model. Don't move that logic into a prompt.
- **Privacy of inputs.** Never log, cache, or transmit prompts, evidence, or
  keys beyond what the documented design already does.

When in doubt, read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`SECURITY.md`](SECURITY.md) first.

## Prerequisites

- **Node** — version pinned in [`.nvmrc`](.nvmrc) (currently 24). `nvm use`.
- **Rust** — stable toolchain with `rustfmt` and `clippy` (see
  [`rust-toolchain.toml`](rust-toolchain.toml)).
- **Tauri system dependencies** for your OS — see the platform setup in the
  [README](README.md#getting-started).

## Getting set up

```bash
ONNXRUNTIME_NODE_INSTALL=skip npm ci   # exact versions; skips an unused native runtime
npm run dev           # run the full desktop app (Tauri)
# or
npm run dev:web       # run the frontend in a browser (mocked native layer)
```

## Before you open a pull request

Run the same checks CI does, and make sure they pass locally:

```bash
# Frontend
npm run typecheck     # strict TS, both tsconfigs
npm test              # vitest unit tests
npm run build:web     # typecheck + production web build

# Rust (from src-tauri/)
cargo fmt -- --check
cargo clippy -- -D warnings
cargo test --lib
```

PRs that don't pass `typecheck`, `test`, `clippy -D warnings`, and `fmt` will
fail CI and won't be reviewable until green.

### Tests are not optional

New behaviour needs a test. The deterministic core (RAG ranking, effect-size
extraction, honesty pass, citation handling, security denylist) is unit-tested
precisely because it must behave identically across models and runs — keep that
coverage when you touch it.

## Pull request guidelines

- **One logical change per PR.** Don't bundle an unrelated refactor with a fix.
- **Describe the *why*,** not just the *what* — the reasoning is the valuable
  part of the diff.
- **No new runtime dependencies** without justification; prefer the platform and
  the standard library. New deps must carry a compatible license (see below).
- **Keep the diff focused.** Match the surrounding code's style and altitude.
- Update docs (`README.md`, `docs/`) when behaviour changes.

## Licensing of contributions

HashCerebrum is licensed under **AGPL-3.0-or-later**. By contributing, you agree
that your contribution is licensed under the same terms. Do not add code or
assets whose license is incompatible with AGPL-3.0, and record any new bundled
asset's license in [`docs/LICENSES.md`](docs/LICENSES.md) and third-party code
in [`THIRDPARTY-LICENSES.md`](THIRDPARTY-LICENSES.md).

## Reporting bugs and requesting features

Use the issue templates. For bugs, include your OS, app version, exact steps,
and what you expected versus what happened. Never paste API keys, prompts
containing patient data, or other secrets into an issue.

## Security

**Do not report security issues in a public issue or PR.** Follow the private
disclosure process in [`SECURITY.md`](SECURITY.md) (GitHub Security Advisories).

## Code of conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). Be
respectful.
