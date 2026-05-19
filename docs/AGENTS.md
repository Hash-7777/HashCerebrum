# Agents

HashCerebrum runs a fixed swarm of six agents. Adding a seventh is a
compile-time error (`AGENTS` tuple in `src/config/agents.ts`).

## Roster

| Agent          | Region binding   | Role |
|----------------|------------------|------|
| Librarian      | Hippocampus      | PubMed / Europe PMC / OpenAlex literature search |
| Trialist       | Frontal          | ClinicalTrials.gov queries, cohort analysis |
| Pharmacologist | Basal ganglia    | RxNorm / OpenFDA — drug interactions & safety |
| Synthesizer    | Parietal         | PICO / GRADE evidence synthesis drafts |
| Citation       | Occipital        | BibTeX / CSL-JSON / provenance |
| Critic         | Amygdala         | Evidence-hierarchy + hallucination audit |

The Thalamus is unbound — it represents the orchestrator (the ToolLoop
itself). When *any* agent is active, the thalamus pulses subtly.

## Lifecycle

```
AgentBase.run({ input })
  → bus.emit('agent:activity', { phase: 'start' })
  → bus.emit('region:light',   { region: <bound>, source: 'agent', intensity: 0.7, ttlMs: 30000 })
  → ToolLoop:
      loop until no tool_calls or maxIter (12):
        provider.complete(messages + tools)
        for each tool_call:
          bus.emit('agent:activity', { phase: 'tool_call' })
          tool.execute(args)
          bus.emit('agent:activity', { phase: 'tool_result' })
          messages.push({ role: 'tool', content: result })
        classify(model_output) → topic:detected → region:light accents
  → bus.emit('agent:activity', { phase: 'done' })
```

## Adding tools to an agent

1. Implement `Tool` in a new file under `src/core/tools/`.
2. Register it on app boot (typically `main.tsx` or a `tools/index.ts`
   barrel).
3. Add the tool name to the agent's `ctx.tools` array.
4. If the tool calls a medical source, the underlying Rust command must
   already exist (`src-tauri/src/commands/medical/*.rs`).

## System prompt discipline

Every agent prompt enforces three rules:

1. **Source-grounded** — no claims without a citable source.
2. **Evidence-hierarchy aware** — case report ≠ RCT.
3. **Citation discipline** — every clinical assertion has a citation.

The Critic agent's only job is auditing prior agents against these rules.
