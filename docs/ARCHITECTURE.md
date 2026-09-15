# Architecture

## Layering (top to bottom)

```
src/ui/                  React shell — never calls Tauri directly
   ↓
src/features/            Per-mode views (brain/, memory/, peer_review/, ...)
   ↓
src/features/brain/swarm Boss routing, specialist runs, manuscript drafting
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

## Data flow — example: Literature specialist run

1. `BrainMode.runTurn` calls `runSwarm({ question, callbacks })`.
2. `runSwarm` asks the boss to route the turn with `planResearch`.
3. `BrainMode` callbacks emit `agent:activity`; `brainStore` maps activity to
   `region:light` for the bound region plus a subtle thalamus relay.
   *(Note: `region:light` EventBus emission is currently de-wired — the 3D brain
   lights on Memory-diagram click only. Re-wiring is tracked as A1 in the
   improvement plan.)*
4. `runSpecialist(agentById('literature'), ...)` calls the LLM via
   `ProviderRegistry`.
5. LLM tool calls execute through `ToolRegistry`.
6. Each medical tool calls `platform().medical.pubmed(...)` → `invoke('pubmed_search')`.
7. Rust `commands::medical::pubmed::pubmed_search` calls `commands::net::net_get`.
8. `net_get` → `security::guard::check(Net{host})` → `denylist` then
   `policy::host_allowed`.
9. If allowed: HTTP fetch, audit-append, return body.
10. Tool-result callbacks keep emitting `agent:activity`, and source/topic hits
    emit `region:light` accents while the brain glow decays.

## Data flow — Brain paper request

Full paper requests no longer ask a model to write a manuscript directly from a
prompt. `runSwarm` forces a source-led evidence-review path:

1. `detectPaperRequest(question)` switches the turn into paper mode.
2. `fallbackPaperTasks(question)` supplies the fixed paper roles:
   Literature & evidence, Clinical trials, and Statistics & data. Topic-specific
   agents such as Pharmacology, Drug interactions, Dentistry, and Public health
   are added only when relevant.
3. Specialists retrieve guarded records from PubMed/MEDLINE, Europe PMC,
   ClinicalTrials.gov, OpenAlex, openFDA, and RxNorm. openFDA/RxNorm are context
   sources for drug identity and safety, not primary clinical-effect evidence.
4. `mergeEvidence()` de-duplicates and ranks records by source credibility,
   identifiers, recency, and available snippet detail.
5. `preparePaperLedger()` extracts structured evidence rows with source markers,
   study design, population, exposure/intervention, comparator, outcomes,
   sample size, effect values, limitations, and trust status.
6. `buildClaimLedger()` converts extracted rows into section-targeted claims.
   The ledger preserves every source marker and grades evidence strength.
7. `buildPaperBlueprint()` maps required claims, source markers, tables, and
   figures to the fixed manuscript section plan.
8. `compileManuscriptFromLedger()` asks The Cerebrum to write each section from
   approved ledger claims only. The model may use only approved `[S#]` markers
   and may not invent statistics, trial outcomes, references, or pooled effects.
9. `validatePaperPackage()` withholds export-ready status if sections are too
   thin, citations do not resolve, the clinical-results section has no
   source-backed findings, statistical claims are unsupported, inline citations
   and references disagree, or the abstract overstates the body. After the last
   repair pass, problems a repair could not fix are downgraded to warnings. A
   paper that is not export-ready still exports, with an INCOMPLETE DRAFT banner
   inside the document.
10. `buildPublicationArtifact()` stores the manuscript, canonical Vancouver
    references, evidence extraction table, claim ledger, source-yield statistics,
    evidence-strength counts, extracted numeric-statistics table when present,
    figures, compliance checks, and QA blockers/warnings.

The paper path is intentionally conservative: missing effect sizes produce an
honest warning and source-yield/evidence-strength statistics, not fabricated
meta-analysis results.

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
