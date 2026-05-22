# Agents

HashCerebrum runs a fixed swarm of six agents: one boss and five specialists.
Adding a seventh is a compile-time error (`AGENTS` tuple in
`src/config/agents.ts`).

## Roster

| Agent              | Region binding | Role |
|--------------------|----------------|------|
| Boss               | Frontal        | Routes questions, delegates research, synthesizes findings |
| Pharmacology       | Basal ganglia  | RxNorm / OpenFDA drug interactions and safety |
| Clinical trials    | Parietal       | ClinicalTrials.gov queries, cohorts, and outcomes |
| Literature & evidence | Hippocampus | PubMed / Europe PMC / OpenAlex literature search |
| Dentistry          | Temporal       | Oral health and dental treatment evidence |
| Public health      | Occipital      | Epidemiology, prevention, vaccination, and population health |

The Thalamus is unbound — it represents the orchestrator (the ToolLoop
itself). When agent activity is emitted, the thalamus pulses subtly alongside
the agent's bound region.

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

The Critic agent's only job is auditing prior agents against these rules.
