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

// Intent decides which track (and how many stages) the pipeline shows — a full
// paper has the longest pipeline; a drug or gene check ends at a graded report; a
// lookup/RAG answer is the shortest.
export type WorkflowIntent = 'paper' | 'evidence_review' | 'drug_interactions' | 'genetics' | 'lookup' | 'rag';

const ICONS = {
  route: I('M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 6a9 9 0 0 1-9 9'),
  retrieve: I('M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'),
  claims: I('M9 6h11M9 12h11M9 18h11M4 5.5l1.2 1.2L7.5 4.3M4 11.5l1.2 1.2L7.5 10.3M4 17.5l1.2 1.2L7.5 16.3'),
  draft: I('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'),
  qa: I('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4'),
  grade: I('M20 6L9 17l-5-5'),
  score: I('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2'),
  report: I('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6'),
  final: I('M12 3v12m0 0l4-4m-4 4l-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'),
};

const S = {
  route: { id: 'route', label: 'Route & plan', hint: 'decompose the question', icon: ICONS.route },
  retrieve: { id: 'retrieve', label: 'Retrieve evidence', hint: 'query biomedical databases', icon: ICONS.retrieve },
  claims: { id: 'claims', label: 'Extract & grade claims', hint: 'build the claim ledger', icon: ICONS.claims },
  draft: { id: 'draft', label: 'Draft manuscript', hint: 'write cited sections', icon: ICONS.draft },
  qa: { id: 'qa', label: 'QA & validate', hint: 'check citations & depth', icon: ICONS.qa },
  final: { id: 'final', label: 'Finalise', hint: 'export-ready paper', icon: ICONS.final },
  grade: { id: 'grade', label: 'Grade interactions', hint: 'score each pair A–X', icon: ICONS.grade },
  score: { id: 'score', label: 'Score association', hint: 'deterministic confidence', icon: ICONS.score },
  report: { id: 'report', label: 'Report', hint: 'cited, verified answer', icon: ICONS.report },
} satisfies Record<string, Stage>;

const TRACKS: Record<WorkflowIntent, Stage[]> = {
  paper: [S.route, S.retrieve, S.claims, S.draft, S.qa, S.final],
  evidence_review: [S.route, S.retrieve, S.claims, S.draft, S.qa, S.final],
  drug_interactions: [S.route, S.retrieve, S.grade, S.report],
  genetics: [S.route, S.retrieve, S.score, S.report],
  lookup: [S.route, S.retrieve, S.report],
  rag: [S.route, S.retrieve, S.report],
};

const TITLES: Record<WorkflowIntent, string> = {
  paper: 'Research pipeline',
  evidence_review: 'Research pipeline',
  drug_interactions: 'Interaction check',
  genetics: 'Genetics check',
  lookup: 'Quick lookup',
  rag: 'Memory recall',
};

type RunState = 'idle' | 'running' | 'done';

// Map the latest activity detail/phase to a 0..1 progress, then to the active
// track's stage index — so one mapper serves every track length.
function progressFromDetail(detail: string, phase: string): number {
  const d = detail.toLowerCase();
  if (/\bblocked\b|export ready|finalis|complete|report/.test(d) || phase === 'done') return 1;
  if (/qa repair|validat/.test(d)) return 0.85;
  if (/draft/.test(d)) return 0.65;
  if (/grade|score|synthesi|extract|building claims|claim review/.test(d)) return 0.5;
  if (/search|deleg|pubmed|europe pmc|openalex|clinicaltrials|gwas|clinvar|rxnorm|records|rag_search|tool/.test(d)) return 0.3;
  if (/rout/.test(d)) return 0.08;
  return 0.08;
}

function useWorkflowStage(statuses: AgentStatus[], stageCount: number): { active: number; state: RunState } {
  const latest = useAgentStore((s) => s.activity[0]);
  const anyRunning = statuses.some((s) => s.state === 'running');
  return useMemo(() => {
    if (!latest) return { active: 0, state: 'idle' as RunState };
    const progress = progressFromDetail(latest.detail ?? '', latest.phase);
    const active = Math.min(stageCount - 1, Math.round(progress * (stageCount - 1)));
    if (latest.phase === 'done' && !anyRunning) return { active: stageCount - 1, state: 'done' as RunState };
    if (!anyRunning && active === 0) return { active: 0, state: 'idle' as RunState };
    return { active, state: 'running' as RunState };
  }, [latest, anyRunning, stageCount]);
}

const CHECK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

export const BrainWorkflow2D = memo(function BrainWorkflow2D({
  statuses,
  intent = 'evidence_review',
}: {
  statuses: AgentStatus[];
  intent?: WorkflowIntent;
}) {
  const stages = TRACKS[intent] ?? TRACKS.evidence_review;
  const { active, state } = useWorkflowStage(statuses, stages.length);
  const pct = state === 'done' ? 100 : state === 'idle' ? 0 : Math.round(((active + 1) / stages.length) * 100);

  return (
    <div className="wf" data-stage={active} data-state={state} data-count={stages.length} aria-label="Pipeline progress">
      <div className="wf-head">
        <span className="wf-title">{TITLES[intent] ?? 'Research pipeline'}</span>
        <span className="wf-phase">{state === 'idle' ? 'Idle' : state === 'done' ? 'Complete' : stages[active]?.label}</span>
      </div>
      <div className="wf-meter" aria-hidden="true"><span className="wf-meter-fill" style={{ width: `${pct}%` }} /></div>
      <ol className="wf-stages">
        {stages.map((stage, i) => {
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
