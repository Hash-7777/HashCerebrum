# Agents

HashCerebrum runs a fixed swarm of six agents: one boss and five
specialists. Adding a seventh is a compile-time error (`AGENTS` tuple in
`src/config/agents.ts`).

## Roster

| Agent               | Region binding | Role |
|---------------------|----------------|------|
| Boss (The Cerebrum) | Frontal        | Routes questions, delegates research, synthesizes findings |
| Pharmacist          | Basal ganglia  | Drugs, dosing, pharmacokinetics, adverse effects **and** drug-drug/-food/-herb interactions (RxNorm / openFDA) — the combined drug expert in Brain mode |
| Clinical research   | Parietal       | ClinicalTrials.gov cohorts and outcomes, plus trial statistics and effect sizes |
| Evidence synthesis  | Hippocampus    | PubMed / Europe PMC / OpenAlex / Semantic Scholar — reviews, mechanisms, epidemiology, prevention, oral health |
| Genetics            | Cerebellum     | GWAS Catalog / ClinVar — gene-variant ↔ disease associations with effect sizes |
| Drug interactions   | Amygdala       | Drug-drug interactions, contraindications, adverse drug events — reserved for the dedicated Drug Interactions mode |

In **Brain** mode the boss plans across the first five specialists (the
`BRAIN_SPECIALIST_AGENTS` pool). The **Drug interactions** agent is excluded
from that pool — it is invoked directly by the dedicated Drug Interactions mode,
while the **Pharmacist** covers interactions inside Brain. Unbound regions
(thalamus, temporal, occipital, brainstem) carry only topic-detection accents.

## Lifecycle

```
BrainMode.runTurn(query)
  → runSwarm({ question, callbacks })
  → callbacks emit bus.emit('agent:activity', { agentId, phase, light? })
  → brainStore maps agent:activity → region:light for <bound> + thalamus
  → runSpecialist:
      loop until no tool_calls or max rounds (3):
        completeWithModelChain(messages + tools)
        for each tool_call:
          callbacks.onToolCall(agentId, toolName) → agent:activity
          tool.execute(args)
          callbacks.onToolResult(agentId, toolName, count) → agent:activity
          messages.push({ role: 'tool', content: result })
        classify(model_output) → topic:detected → region:light accents
  → callbacks.onSpecialistDone(agentId, recordCount) → agent:activity
```

For full paper requests, `runSwarm` routes the retrieved records through the
paper pipeline instead of asking a model to write a paper from a prompt:

```
runPaperPipeline
  → extractEvidenceFromRecords
  → buildClaimLedger
  → buildPaperBlueprint
  → compileManuscriptFromLedger
  → validatePaperPackage
  → buildPublicationArtifact
```

The paper pipeline is source-led. It stores an evidence extraction table, claim
ledger, source-yield statistics, evidence-strength counts, extracted numeric
statistics when traceable, and QA blockers/warnings in the manuscript artifact.
PDF export is blocked when citations, sections, statistics, or source-backed
findings fail validation.

## Adding tools to an agent

1. Implement `Tool` in a new file under `src/core/tools/`.
2. Register it on app boot (typically `main.tsx` or a `tools/index.ts`
   barrel).
3. Add the tool name to the agent's `tools` array in `src/config/agents.ts`.
4. If the tool calls a medical source, the underlying Rust command must
   already exist (`src-tauri/src/commands/medical/*.rs`).

## System prompt discipline

Every agent prompt enforces three rules:

1. **Source-grounded** — no claims without a citable source.
2. **Evidence-hierarchy aware** — case report ≠ RCT.
3. **Citation discipline** — every clinical assertion has a citation.

For manuscript generation, The Cerebrum compiles from the approved claim ledger
only. References remain app-owned and deterministic; models do not write the
bibliography.
