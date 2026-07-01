import { memo, useMemo, type ReactNode } from 'react';
import { useAgentStore } from '@core/store/agentStore';
import type { AgentStatus } from './AgentPanel';

// A GPU-free, premium 2D view of the research pipeline, shown in Lite mode instead
// of the 3D brain. A gradient rail SLIDES to the active stage; each stage carries a
// rounded icon tile (done → check, active → glowing accent + sliding sheen, pending
// → muted) and a status chip. All motion is CSS driven off data-stage / data-state
// attributes (never inline dynamic styles), so it stays crisp under the nonce'd CSP
// and costs no WebGL/GPU.

interface Stage {
  id: string;
  label: string;
  hint: string;
  icon: ReactNode;
}

const I = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const STAGES: Stage[] = [
  { id: 'route', label: 'Route & plan', hint: 'decompose the question', icon: I('M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 6a9 9 0 0 1-9 9') },
  { id: 'retrieve', label: 'Retrieve evidence', hint: 'query biomedical databases', icon: I('M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3') },
  { id: 'claims', label: 'Extract & grade claims', hint: 'build the claim ledger', icon: I('M9 6h11M9 12h11M9 18h11M4 5.5l1.2 1.2L7.5 4.3M4 11.5l1.2 1.2L7.5 10.3M4 17.5l1.2 1.2L7.5 16.3') },
  { id: 'draft', label: 'Draft manuscript', hint: 'write cited sections', icon: I('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z') },
  { id: 'qa', label: 'QA & validate', hint: 'check citations & depth', icon: I('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4') },
  { id: 'final', label: 'Finalise', hint: 'export-ready paper', icon: I('M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2') },
];

type RunState = 'idle' | 'running' | 'done';

// Map the latest activity detail/phase to a pipeline stage index.
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

function useWorkflowStage(statuses: AgentStatus[]): { active: number; state: RunState } {
  const latest = useAgentStore((s) => s.activity[0]);
  const anyRunning = statuses.some((s) => s.state === 'running');
  return useMemo(() => {
    if (!latest) return { active: 0, state: 'idle' as RunState };
    const stage = stageFromDetail(latest.detail ?? '', latest.phase);
    if (latest.phase === 'done' && !anyRunning) return { active: 5, state: 'done' as RunState };
    if (!anyRunning && stage === 0) return { active: 0, state: 'idle' as RunState };
    return { active: stage, state: 'running' as RunState };
  }, [latest, anyRunning]);
}

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const BrainWorkflow2D = memo(function BrainWorkflow2D({ statuses }: { statuses: AgentStatus[] }) {
  const { active, state } = useWorkflowStage(statuses);
  const pct = state === 'done' ? 100 : state === 'idle' ? 0 : Math.round(((active + 1) / STAGES.length) * 100);

  return (
    <div className="wf" data-stage={active} data-state={state} aria-label="Research pipeline progress">
      <div className="wf-head">
        <span className="wf-title">Research pipeline</span>
        <span className="wf-phase">{state === 'idle' ? 'Idle' : state === 'done' ? 'Complete' : STAGES[active]?.label}</span>
      </div>
      <div className="wf-meter" aria-hidden="true"><span className="wf-meter-fill" /></div>
      <ol className="wf-stages">
        {STAGES.map((stage, i) => {
          const rowState = state === 'done' || i < active ? 'done' : i === active && state === 'running' ? 'active' : 'pending';
          return (
            <li key={stage.id} className="wf-row" data-row-state={rowState}>
              <span className="wf-rail" aria-hidden="true" />
              <span className="wf-tile" aria-hidden="true">
                <span className="wf-tile-icon">{rowState === 'done' ? CHECK : stage.icon}</span>
                <span className="wf-sheen" />
              </span>
              <span className="wf-body">
                <span className="wf-label">{stage.label}</span>
                <span className="wf-hint">{stage.hint}</span>
              </span>
              <span className="wf-chip">{rowState === 'done' ? 'Done' : rowState === 'active' ? 'Active' : 'Queued'}</span>
            </li>
          );
        })}
      </ol>
      <div className="wf-foot">
        <span className="wf-foot-pct">{pct}%</span>
        <span className="wf-foot-label">source-grounded &amp; validated</span>
      </div>
    </div>
  );
});
