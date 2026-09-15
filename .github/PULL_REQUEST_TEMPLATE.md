<!--
Thanks for contributing to HashCerebrum!
Please read CONTRIBUTING.md first. Keep one logical change per PR.
-->

## What this changes

<!-- A concise description of the change and, more importantly, the *why*. -->

## Related issue

<!-- e.g. Closes #123 — or "none" -->

## How it was tested

<!-- Commands you ran and their result. -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:web`
- [ ] `cargo fmt -- --check` (if Rust changed)
- [ ] `cargo clippy -- -D warnings` (if Rust changed)
- [ ] `cargo test --lib` (if Rust changed)

## Checklist

- [ ] One logical change, focused diff
- [ ] No telemetry, accounts, cloud sync, or other phone-home behaviour
- [ ] Deterministic logic stays in code, not in prompts
- [ ] No secrets, keys, or private data in the diff or commit messages
- [ ] New behaviour has tests
- [ ] Docs updated if behaviour changed
- [ ] New dependencies/assets carry an AGPL-compatible license and are recorded
      in `THIRDPARTY-LICENSES.md` (run `npm run licenses`) / `docs/LICENSES.md`
