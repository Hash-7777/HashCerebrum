# Architecture

## Layering (top to bottom)

```
src/ui/                  React shell — never calls Tauri directly
   ↓
src/modes/               Per-mode views (Brain, Research, ...)
   ↓
src/agents/              Agent classes + tool loop
   ↓
src/core/                Bus, store, llm registry, topic classifier
   ↓
src/platform/            Tauri / browser adapter (THE ONLY caller of invoke())
   ↓
src-tauri/src/commands/  IPC surface
   ↓
src-tauri/src/security/  Guard — every privileged action passes through here
   ↓
src-tauri/src/audit/     Hash-chained append-only log
```

A layer may only import from the layer immediately below or sibling
files within its layer. Skipping layers (e.g. a mode reaching directly
into `platform/`) is a code review rejection.

## Architecture guardrails

| Risk                                        | HashCerebrum guard                                         |
|---------------------------------------------|-------------------------------------------------------------|
| Unbounded feature growth                    | Vite + per-feature folders, ESM imports, tuple-capped modes |
| Untyped runtime bridges                     | Typed `EventBus` + Zustand stores                          |
| Cross-layer coupling                        | Layering enforced from day 1                                |
| Runtime-only safety                         | TypeScript strict + `noUncheckedIndexedAccess`              |
| Renderer calling external APIs directly     | All external HTTP gated through Rust `security::guard`      |
| Audit log tampering                         | Hash-chained — tampering is detectable via `audit_log_verify` |

## Data flow — example: Librarian agent run

1. UI dispatches `getAgent('librarian').run({ input: [...] })`
2. `AgentBase.run` emits `agent:activity start` and `region:light hippocampus`
3. `ToolLoop` calls the LLM via `ProviderRegistry`
4. LLM returns tool_calls → loop executes each via `ToolRegistry`
5. Each medical tool calls `platform().medical.pubmed(...)` → `invoke('pubmed_search')`
6. Rust `commands::medical::pubmed::pubmed_search` calls `commands::net::net_get`
7. `net_get` → `security::guard::check(Net{host})` → `denylist` then `policy::host_allowed`
8. If allowed: HTTP fetch, audit-append, return body
9. Response streams back; topic classifier hits emit `region:light` accents
10. `agent:activity done` decays the region glow over 30 s

## Per-mode hard cap

The `MODES` constant in `src/config/modes.ts` is typed as a tuple of
exactly `MAX_MODES`. Adding a sixth entry produces a TypeScript error
at the declaration site, not a runtime surprise.

Same pattern for agents in `src/config/agents.ts`.

## Adding a new medical source

1. Add the host to `src-tauri/src/security/policy.rs::ALLOWED_HOSTS`
2. Add it to `tauri.conf.json` CSP `connect-src` ONLY if the renderer
   will hit it directly (it usually shouldn't — let Rust proxy)
3. Create `src-tauri/src/commands/medical/<name>.rs`
4. Register the command in `src-tauri/src/lib.rs::invoke_handler!`
5. Add binding in `src/platform/index.ts::Platform::medical`
6. Implement in `src/platform/tauri/index.ts` and `browser/index.ts`
7. Expose as a tool in `src/core/tools` if agents should call it
