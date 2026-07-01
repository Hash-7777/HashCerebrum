import { memo, useMemo } from 'react';
import { useAgentStore } from '@core/store/agentStore';
import type { AgentStatus } from './AgentPanel';

// A GPU-free 2D view of the research pipeline, shown in Lite mode instead of the
// 3D brain. It is a smooth vertical stepper: a rail fill SLIDES to the active
// stage, the running stage carries a sliding sheen, completed stages settle, and
// pending stages stay dim. All motion is CSS driven off a `data-stage` /
// `data-state` attribute (never inline dynamic styles), so it stays crisp and the
// nonce'd CSP cannot strip it, and it costs no WebGL/GPU.

interface Stage {
  id: string;
  label: string;
  hint: string;
}

const STAGES: Stage[] = [
  { id: 'route', label: 'Route & plan', hint: 'decompose the question' },
  { id: 'retrieve', label: 'Retrieve evidence', hint: 'query biomedical databases' },
  { id: 'claims', label: 'Extract & grade claims', hint: 'build the claim ledger' },
  { id: 'draft', label: 'Draft manuscript', hint: 'write cited sections' },
  { id: 'qa', label: 'QA & validate', hint: 'check citations & depth' },
  { id: 'final', label: 'Finalise', hint: 'export-ready paper' },
];

type RunState = 'idle' | 'running' | 'done';

// Map the latest activity detail/phase to a pipeline stage index. Detail strings
// come from the boss/pipeline ("Paper pipeline - Searching", "Drafting manuscript
// - Methods", "QA repair (pass 1)", …); we match on the stable keywords.
function stageFromDetail(detail: string, phase: string): number {
  const d = detail.toLowerCase();
  if (/\bblocked\b|export ready|finalis|complete/.test(d) || phase === 'done') return 5;
  if (/qa repair|validat/.test(d)) return 4;
  if (/draft/.test(d)) return 3;
  if (/extract|building claims|claim review|synthesi/.test(d)) return 2;
  if (/search|deleg|pubmed|europe pmc|openalex|clinicaltrials|records|rag_search|tool/.test(d)) return 1;
  if (/rout/.test(d)) return 0;
  return 0;
}

interface Derived {
  active: number;
  state: RunState;
}

function useWorkflowStage(statuses: AgentStatus[]): Derived {
  const latest = useAgentStore((s) => s.activity[0]);
  const anyRunning = statuses.some((s) => s.state === 'running');
  return useMemo<Derived>(() => {
    if (!latest) return { active: 0, state: 'idle' };
    const stage = stageFromDetail(latest.detail ?? '', latest.phase);
    if (latest.phase === 'done' && !anyRunning) return { active: 5, state: 'done' };
    if (!anyRunning && stage === 0) return { active: 0, state: 'idle' };
    return { active: stage, state: 'running' };
  }, [latest, anyRunning]);
}

export const BrainWorkflow2D = memo(function BrainWorkflow2D({ statuses }: { statuses: AgentStatus[] }) {
  const { active, state } = useWorkflowStage(statuses);

  return (
    <div className="wf" data-stage={active} data-state={state} aria-label="Research pipeline progress">
      <div className="wf-head">
        <span className="wf-title">Research pipeline</span>
        <span className="wf-phase">{state === 'idle' ? 'idle' : state === 'done' ? 'complete' : STAGES[active]?.label}</span>
      </div>
      <div className="wf-track">
        <div className="wf-rail" aria-hidden="true">
          <div className="wf-rail-fill" />
        </div>
        <ol className="wf-stages">
          {STAGES.map((stage, i) => {
            const rowState = state === 'done' || i < active ? 'done' : i === active && state === 'running' ? 'active' : 'pending';
            return (
              <li key={stage.id} className="wf-row" data-row-state={rowState}>
                <span className="wf-marker" aria-hidden="true" />
                <span className="wf-body">
                  <span className="wf-label">{stage.label}</span>
                  <span className="wf-hint">{stage.hint}</span>
                  <span className="wf-sheen" aria-hidden="true" />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
});
