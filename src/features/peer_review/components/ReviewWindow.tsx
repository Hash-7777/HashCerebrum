import { useRef, useState } from 'react';
import { usePeerReviewStore, type AgentReviewResult, type ReviewedPaper } from '@core/store/peerReviewStore';
import { agentModelFor } from '@core/store/agentModelStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';
import { initialSwarmAgents, runReviewSwarm, REVIEW_SWARM_AGENTS } from '../reviewSwarm';
import { buildReviewReportPdf } from '../reviewReportPdf';
import { downloadBlob } from '@features/brain/export/messageExport';

// ── Sub-components ────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const tier = score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low';
  return (
    <div className="review-score-ring" data-tier={tier}>
      <span className="review-score-number">{score}</span>
      <span className="review-score-denom">/10</span>
    </div>
  );
}

function AgentDot({ status }: { status: AgentReviewResult['status'] }) {
  return <span className={`review-agent-dot review-agent-dot--${status}`} aria-hidden="true" />;
}

function AgentSection({
  agent,
  def,
}: {
  agent: AgentReviewResult;
  def: { label: string; iconName: string };
}) {
  const [open, setOpen] = useState(false);
  const hasContent = agent.text.length > 0;

  return (
    <div className={`review-agent-section review-agent-section--${agent.status}`}>
      <button
        type="button"
        className="review-agent-section-head"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasContent}
      >
        <AgentDot status={agent.status} />
        <span className="review-agent-section-label">{def.label}</span>
        <span className="review-agent-section-status">
          {agent.status === 'running' ? (
            <Icon name="spinner" size={11} />
          ) : agent.status === 'error' ? (
            <Icon name="alert" size={11} />
          ) : agent.status === 'done' ? (
            agent.items.length > 0 ? `${agent.items.length} items` : 'done'
          ) : (
            'waiting'
          )}
        </span>
        {hasContent && (
          <span className={`review-agent-chevron${open ? ' open' : ''}`} aria-hidden="true">
            <Icon name="chevDown" size={11} />
          </span>
        )}
      </button>
      {open && hasContent && (
        <div className="review-agent-section-body">
          {agent.status === 'error' ? (
            <p className="review-agent-error">{agent.error}</p>
          ) : agent.items.length > 0 ? (
            <ul>
              {agent.items.map((item, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static list
                <li key={i}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="review-agent-raw">{agent.text}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Left pane: document preview ───────────────────────────────────────────

function isPdfBinary(text: string): boolean {
  return text.trimStart().startsWith('%PDF-');
}

function DocumentPane({ paper }: { paper: ReviewedPaper }) {
  if (paper.htmlContent) {
    return (
      <iframe
        srcDoc={paper.htmlContent}
        title={paper.title}
        className="review-pdf-frame"
        sandbox=""
      />
    );
  }

  // For uploaded PDFs the extracted text is binary garbage — show a nice card.
  if (paper.source === 'upload' && isPdfBinary(paper.text)) {
    return (
      <div className="review-upload-placeholder">
        <Icon name="document" size={40} />
        <strong>{paper.title}</strong>
        <p>
          PDF preview is unavailable in this environment. The AI review was run on
          the best-effort extracted text.
        </p>
        {paper.blobUrl && (
          <a
            href={paper.blobUrl}
            download={paper.filename}
            className="review-upload-download"
          >
            <Icon name="download" size={13} /> Download original PDF
          </a>
        )}
      </div>
    );
  }

  // Readable extracted text — format it nicely
  return (
    <div className="review-pdf-text">
      <pre>{paper.text.slice(0, 40_000)}</pre>
    </div>
  );
}

// ── Main window ───────────────────────────────────────────────────────────

export function ReviewWindow({ paper, onClose }: { paper: ReviewedPaper; onClose: () => void }) {
  const setReview          = usePeerReviewStore((s) => s.setReview);
  const setReviewStreaming = usePeerReviewStore((s) => s.setReviewStreaming);
  const setReviewError     = usePeerReviewStore((s) => s.setReviewError);
  const setReviewAgents    = usePeerReviewStore((s) => s.setReviewAgents);
  const patchReviewAgent   = usePeerReviewStore((s) => s.patchReviewAgent);

  const abortRef = useRef<AbortController | null>(null);
  const [exportBusy, setExportBusy] = useState(false);

  // Derive live agent list: prefer real-time reviewAgents, fall back to
  // agentResults inside the completed review, then initial idle list.
  const liveAgents: AgentReviewResult[] =
    paper.reviewAgents ??
    paper.review?.agentResults ??
    initialSwarmAgents();

  const runReview = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset state
    const fresh = initialSwarmAgents();
    setReviewAgents(paper.id, fresh);
    setReviewStreaming(paper.id, true);

    const model = agentModelFor('boss');
    try {
      const review = await runReviewSwarm(
        model,
        paper.text,
        (agentId, patch) => patchReviewAgent(paper.id, agentId, patch),
        controller.signal,
      );
      setReview(paper.id, review);
      // Sync final agent results into reviewAgents for display
      if (review.agentResults) setReviewAgents(paper.id, review.agentResults);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      const detail = error instanceof Error ? error.message : String(error);
      setReviewError(paper.id, detail);
      useToastStore.getState().show('Peer review failed', 'error');
    }
  };

  const exportPdf = async () => {
    if (!paper.review) return;
    setExportBusy(true);
    try {
      const blob = await buildReviewReportPdf(paper);
      const slug = paper.title.slice(0, 48).replace(/\s+/g, '-').toLowerCase();
      downloadBlob(`${slug}-peer-review.pdf`, blob);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Export failed: ${detail}`, 'error');
    } finally {
      setExportBusy(false);
    }
  };

  const { review, reviewStreaming, reviewError } = paper;
  const anyRunning = liveAgents.some((a) => a.status === 'running');
  const allDone    = liveAgents.every((a) => a.status === 'done' || a.status === 'error');

  return (
    <div className="review-window" role="dialog" aria-label="Peer review" aria-modal="true">
      {/* Close */}
      <button
        type="button"
        className="review-window-close"
        aria-label="Close review"
        onClick={() => {
          abortRef.current?.abort();
          onClose();
        }}
      >
        <Icon name="close" size={16} />
      </button>

      <div className="review-window-body">
        {/* ── Left: document ─────────────────────────────────── */}
        <div className="review-pdf-pane">
          <DocumentPane paper={paper} />
        </div>

        {/* ── Right: swarm analysis ───────────────────────────── */}
        <aside className="review-sidebar">
          {/* Header */}
          <header className="review-sidebar-header">
            <div>
              <p className="eyebrow">
                <Icon name="shield" size={10} /> Peer Review
              </p>
              <h3 className="review-sidebar-title">{paper.title}</h3>
            </div>
            {review && <ScoreRing score={review.score} />}
          </header>

          {/* Overall summary when done */}
          {review && (
            <div className="review-summary-block">
              <p className="review-summary-text">{review.summary}</p>
              {review.publishReadiness && (
                <p className="review-readiness">{review.publishReadiness}</p>
              )}
            </div>
          )}

          {/* Error */}
          {reviewError && !reviewStreaming && (
            <div className="review-sidebar-error">
              <Icon name="alert" size={14} /> {reviewError}
            </div>
          )}

          {/* ── Swarm agent list ─────────────────────────────── */}
          <div className="review-swarm-panel">
            <p className="review-swarm-label">
              <Icon name="activity" size={10} />
              Analysis Swarm
              {anyRunning && <span className="review-swarm-running">running…</span>}
              {allDone && review && <span className="review-swarm-done">complete</span>}
            </p>

            {liveAgents.map((agent) => {
              const def = REVIEW_SWARM_AGENTS.find((d) => d.agentId === agent.agentId)!;
              return (
                <AgentSection key={agent.agentId} agent={agent} def={def} />
              );
            })}
          </div>

          {/* ── Strengths / Weaknesses when done ──────────────── */}
          {review && review.strengths.length > 0 && (
            <div className="review-bullets-block">
              <p className="review-bullets-label strengths">Strengths</p>
              <ul>
                {review.strengths.map((s, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {review && review.weaknesses.length > 0 && (
            <div className="review-bullets-block">
              <p className="review-bullets-label weaknesses">Weaknesses</p>
              <ul>
                {review.weaknesses.map((w, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static list
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer metadata */}
          {review && (
            <p className="review-sidebar-footer">
              Reviewed by {review.modelUsed} · {new Date(review.reviewedAt).toLocaleString()}
            </p>
          )}

          {/* ── Actions ─────────────────────────────────────────── */}
          <div className="review-actions-bar">
            {!review && !reviewStreaming && (
              <button type="button" className="review-run-btn" onClick={() => void runReview()}>
                <Icon name="shield" size={14} /> Run Peer Review
              </button>
            )}
            {reviewStreaming && (
              <div className="review-sidebar-loading">
                <Icon name="spinner" size={14} />
                <span>Swarm reviewing…</span>
              </div>
            )}
            {review && (
              <>
                <button
                  type="button"
                  className="review-run-btn review-run-btn--accent"
                  onClick={() => void exportPdf()}
                  disabled={exportBusy}
                >
                  <Icon name="download" size={13} />
                  {exportBusy ? 'Exporting…' : 'Export PDF Report'}
                </button>
                <button
                  type="button"
                  className="review-run-btn review-run-btn--secondary"
                  onClick={() => void runReview()}
                  disabled={reviewStreaming}
                >
                  <Icon name="refresh" size={12} /> Re-review
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
