import { useRef, useState, useEffect } from 'react';
import { usePeerReviewStore, type AgentReviewResult, type ReviewedPaper } from '@core/store/peerReviewStore';
import { agentModelFor } from '@core/store/agentModelStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';
import {
  initialSwarmAgents,
  runReviewSwarm,
  REVIEW_SWARM_AGENTS,
  parseSuggestions,
  type Suggestion,
  type SuggestionType,
} from '../reviewSwarm';
import { buildReviewReportPdf } from '../reviewReportPdf';
import { downloadBlob } from '@features/brain/export/messageExport';
import { streamWithModelChain } from '@core/llm/ProviderRegistry';

// ── Editor helpers ────────────────────────────────────────────────────────

type HistoryEntry = { html: string; sugs: Suggestion[] };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHighlightedHtml(text: string, suggestions: Suggestion[]): string {
  type Span = { start: number; end: number; sid: string; type: SuggestionType };
  const spans: Span[] = [];

  for (const s of suggestions) {
    if (s.status !== 'pending') continue;
    const idx = text.indexOf(s.originalText);
    if (idx === -1) continue;
    if (!s.originalText) continue; // unanchored — no mark to place
    const overlaps = spans.some(
      (sp) => idx < sp.end && idx + s.originalText.length > sp.start,
    );
    if (overlaps) continue;
    spans.push({
      start: idx,
      end: idx + s.originalText.length,
      sid: s.id,
      type: s.type,
    });
  }

  spans.sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  for (const span of spans) {
    html += escapeHtml(text.slice(cursor, span.start));
    html +=
      `<mark class="doc-mark doc-mark--${escapeHtml(span.type)}" data-sid="${escapeHtml(span.sid)}">` +
      escapeHtml(text.slice(span.start, span.end)) +
      '</mark>';
    cursor = span.end;
  }
  html += escapeHtml(text.slice(cursor));
  // Preserve line-breaks visually
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ── Review panel sub-components ───────────────────────────────────────────

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

// ── Document preview (read-only, non-editor mode) ─────────────────────────

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

  if (paper.blobUrl && isPdfBinary(paper.text)) {
    // object-src 'none' in the app CSP blocks <object> entirely.
    // frame-src explicitly allows blob: so <iframe src={blobUrl}> is the correct path.
    return (
      <iframe
        src={paper.blobUrl}
        title={paper.title}
        className="review-pdf-frame"
      />
    );
  }

  return (
    <div className="review-pdf-text">
      <pre>{paper.text.slice(0, 40_000)}</pre>
    </div>
  );
}

// ── Suggestion card ───────────────────────────────────────────────────────

const SUGGESTION_TYPE_LABELS: Record<SuggestionType, string> = {
  grammar:     'Grammar',
  vocabulary:  'Vocabulary',
  style:       'Style',
  originality: 'Originality',
  statistics:  'Statistics',
  general:     'General',
};

function SuggestionCard({
  suggestion,
  active,
  onHover,
  onAccept,
  onSkip,
  onFix,
}: {
  suggestion: Suggestion;
  active: boolean;
  onHover: (id: string | null) => void;
  onAccept: (s: Suggestion) => void;
  onSkip: (s: Suggestion) => void;
  onFix: (s: Suggestion) => void;
}) {
  const { status, type, suggestedText } = suggestion;

  if (status === 'accepted') {
    return (
      <div className="suggestion-card suggestion-card--resolved suggestion-card--accepted">
        <span className={`suggestion-type suggestion-type--${type}`}>
          {SUGGESTION_TYPE_LABELS[type]}
        </span>
        <span className="suggestion-resolved-label">✓ Applied</span>
      </div>
    );
  }

  if (status === 'skipped') {
    return (
      <div className="suggestion-card suggestion-card--resolved suggestion-card--skipped">
        <span className={`suggestion-type suggestion-type--${type}`}>
          {SUGGESTION_TYPE_LABELS[type]}
        </span>
        <span className="suggestion-resolved-label">— Skipped</span>
      </div>
    );
  }

  return (
    <div
      className={`suggestion-card${active ? ' suggestion-card--active' : ''}`}
      onMouseEnter={() => onHover(suggestion.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="suggestion-card-head">
        <span className={`suggestion-type suggestion-type--${type}`}>
          {SUGGESTION_TYPE_LABELS[type]}
        </span>
        <span className="suggestion-card-source">{suggestion.description}</span>
      </div>

      {(suggestion.originalText || suggestedText) && (
        <div className="suggestion-diff">
          {suggestion.originalText && (
            <span className="suggestion-diff-before">&ldquo;{suggestion.originalText}&rdquo;</span>
          )}
          {suggestion.originalText && suggestedText && (
            <span className="suggestion-diff-arrow">→</span>
          )}
          {suggestedText && (
            <span className="suggestion-diff-after">&ldquo;{suggestedText}&rdquo;</span>
          )}
        </div>
      )}

      <div className="suggestion-card-actions">
        {suggestedText ? (
          <button
            type="button"
            className="suggestion-btn suggestion-btn--accept"
            onClick={() => onAccept(suggestion)}
          >
            Accept
          </button>
        ) : (
          <button
            type="button"
            className={`suggestion-btn suggestion-btn--fix${status === 'fixing' ? ' suggestion-btn--busy' : ''}`}
            onClick={() => onFix(suggestion)}
            disabled={status === 'fixing'}
          >
            {status === 'fixing' && <Icon name="spinner" size={10} />}
            {status === 'fixing' ? 'Getting fix…' : 'Get Fix'}
          </button>
        )}
        <button
          type="button"
          className="suggestion-btn suggestion-btn--skip"
          onClick={() => onSkip(suggestion)}
        >
          Skip
        </button>
      </div>
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

  const abortRef      = useRef<AbortController | null>(null);
  const editorRef     = useRef<HTMLDivElement | null>(null);
  const historyRef    = useRef<HistoryEntry[]>([]);
  // Capture text + suggestions at the moment of entering editor mode
  const enterDataRef  = useRef<{ text: string; sugs: Suggestion[] }>({ text: '', sugs: [] });

  const [exportBusy,  setExportBusy]  = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSugId, setActiveSugId] = useState<string | null>(null);
  const [showEditor,  setShowEditor]  = useState(false);

  const liveAgents: AgentReviewResult[] =
    paper.reviewAgents ??
    paper.review?.agentResults ??
    initialSwarmAgents();

  // ── Editor init ────────────────────────────────────────────────────────
  // Build the highlighted HTML when the editor first opens.
  // Uses captured ref values so we don't re-run on suggestion state changes.
  useEffect(() => {
    if (!showEditor || !editorRef.current) return;
    editorRef.current.innerHTML = buildHighlightedHtml(
      enterDataRef.current.text,
      enterDataRef.current.sugs,
    );
    historyRef.current = [];
  }, [showEditor]);

  // Sync active-mark highlight when the user hovers a suggestion card
  useEffect(() => {
    if (!showEditor || !editorRef.current) return;
    const marks = editorRef.current.querySelectorAll<HTMLElement>('mark.doc-mark');
    marks.forEach((m) =>
      m.classList.toggle('doc-mark--active', m.dataset.sid === activeSugId),
    );
    if (activeSugId) {
      editorRef.current
        .querySelector<HTMLElement>(`mark[data-sid="${activeSugId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeSugId, showEditor]);

  // ── History helpers ────────────────────────────────────────────────────

  const saveHistory = () => {
    if (!editorRef.current) return;
    historyRef.current.push({
      html: editorRef.current.innerHTML,
      sugs: suggestions.slice(),
    });
  };

  const undoEdit = () => {
    if (!editorRef.current || historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    editorRef.current.innerHTML = prev.html;
    setSuggestions(prev.sugs);
  };

  // ── Suggestion actions ─────────────────────────────────────────────────

  const acceptSuggestion = (s: Suggestion) => {
    if (!editorRef.current) return;
    const mark = editorRef.current.querySelector<HTMLElement>(`mark[data-sid="${s.id}"]`);
    if (mark) {
      // Anchored suggestion: replace the <mark> in-place
      saveHistory();
      const span = document.createElement('span');
      span.className = 'doc-fix-accepted';
      span.textContent = s.suggestedText;
      mark.replaceWith(span);
    } else if (s.originalText && s.suggestedText) {
      // No mark exists (unanchored that was fixed): find the first occurrence
      // of the escaped original in innerHTML and replace it
      const escaped = escapeHtml(s.originalText);
      if (editorRef.current.innerHTML.includes(escaped)) {
        saveHistory();
        editorRef.current.innerHTML = editorRef.current.innerHTML.replace(
          escaped,
          `<span class="doc-fix-accepted">${escapeHtml(s.suggestedText)}</span>`,
        );
      }
    }
    setSuggestions((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, status: 'accepted' } : x)),
    );
  };

  const skipSuggestion = (s: Suggestion) => {
    if (!editorRef.current) return;
    const mark = editorRef.current.querySelector<HTMLElement>(`mark[data-sid="${s.id}"]`);
    if (mark) {
      saveHistory();
      mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
    }
    setSuggestions((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, status: 'skipped' } : x)),
    );
  };

  const fixSuggestion = async (s: Suggestion) => {
    setSuggestions((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, status: 'fixing' } : x)),
    );
    try {
      const rawText   = editorRef.current?.innerText ?? paper.text;
      const isAnchored = s.originalText.length > 0;
      const idx       = isAnchored ? rawText.indexOf(s.originalText) : -1;
      const ctxStart  = Math.max(0, (idx < 0 ? 0 : idx) - 300);
      const ctxEnd    = Math.min(rawText.length, (idx < 0 ? rawText.length / 2 : idx) + (s.originalText.length || 0) + 300);
      const context   = rawText.slice(ctxStart, ctxEnd);

      const model = agentModelFor('boss');
      let result  = '';

      const systemPrompt = isAnchored
        ? 'You are a biomedical writing expert. Propose a specific replacement for a flagged passage.\nRespond ONLY with:\nFIXED: <replacement text>\nNo preamble. No extra lines.'
        : 'You are a biomedical writing expert. A reviewer flagged an issue. Find the EXACT passage in the excerpt that needs changing and propose a replacement.\nRespond ONLY with:\nORIGINAL: <exact passage from the text>\nFIXED: <replacement text>\nNo preamble. No extra lines.';

      const userPrompt = isAnchored
        ? `Issue: ${s.description}\nOriginal: "${s.originalText}"\n\nContext:\n${context}\n\nProvide a concise replacement.`
        : `Issue: ${s.description}\n\nDocument excerpt:\n${context}\n\nFind the exact passage and provide a replacement.`;

      await streamWithModelChain(
        model,
        {
          messages: [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user'   as const, content: userPrompt   },
          ],
          temperature: 0.2,
          maxTokens:   400,
        },
        { onToken: (t) => { result += t; } },
      );

      const origMatch  = /^ORIGINAL:\s*(.+)$/m.exec(result.trim());
      const fixedMatch = /^FIXED:\s*(.+)$/m.exec(result.trim());
      const newOriginal  = origMatch  ? origMatch[1]!.trim()  : s.originalText;
      const fixedText    = fixedMatch ? fixedMatch[1]!.trim() : result.trim();

      // For a newly-anchored suggestion: inject a live <mark> into the editor
      // so the user can see exactly what will change before clicking Accept.
      if (!isAnchored && newOriginal && editorRef.current) {
        const escaped = escapeHtml(newOriginal);
        if (editorRef.current.innerHTML.includes(escaped)) {
          editorRef.current.innerHTML = editorRef.current.innerHTML.replace(
            escaped,
            `<mark class="doc-mark doc-mark--${escapeHtml(s.type)}" data-sid="${escapeHtml(s.id)}">${escaped}</mark>`,
          );
        }
      }

      setSuggestions((prev) =>
        prev.map((x) =>
          x.id === s.id
            ? { ...x, originalText: newOriginal, suggestedText: fixedText, status: 'pending' }
            : x,
        ),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Fix generation failed: ${detail}`, 'error');
      setSuggestions((prev) =>
        prev.map((x) => (x.id === s.id ? { ...x, status: 'pending' } : x)),
      );
    }
  };

  const enterEditor = () => {
    const agentResults = paper.review?.agentResults ?? paper.reviewAgents ?? [];
    const parsed       = parseSuggestions(agentResults);
    enterDataRef.current = { text: paper.text, sugs: parsed };
    setSuggestions(parsed);
    setShowEditor(true);
  };

  // ── Review runner ──────────────────────────────────────────────────────

  const runReview = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current  = controller;

    setShowEditor(false);
    setSuggestions([]);

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
      if (review.agentResults) setReviewAgents(paper.id, review.agentResults);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      const detail = error instanceof Error ? error.message : String(error);
      setReviewError(paper.id, detail);
      useToastStore.getState().show(`Peer review failed: ${detail}`, 'error');
    } finally {
      setReviewStreaming(paper.id, false);
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

  // ── Derived ────────────────────────────────────────────────────────────

  const { review, reviewStreaming, reviewError } = paper;
  const anyRunning   = liveAgents.some((a) => a.status === 'running');
  const allDone      = liveAgents.every((a) => a.status === 'done' || a.status === 'error');
  const pendingCount = suggestions.filter((s) => s.status === 'pending').length;
  const canUndo      = historyRef.current.length > 0;

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
        {/* ── Left pane ───────────────────────────────────────── */}
        <div className="review-pdf-pane">
          {showEditor ? (
            <div className="doc-editor-wrap">
              {/* Toolbar */}
              <div className="doc-editor-toolbar">
                <span className="doc-editor-label">
                  <Icon name="edit" size={11} />
                  Editing document
                </span>
                {pendingCount > 0 && (
                  <span className="doc-editor-count">
                    {pendingCount} remaining
                  </span>
                )}
                <button
                  type="button"
                  className="doc-toolbar-btn"
                  onClick={undoEdit}
                  disabled={!canUndo}
                  title="Undo last accepted or skipped change"
                >
                  <Icon name="refresh" size={11} />
                  Undo
                </button>
                <button
                  type="button"
                  className="doc-toolbar-btn doc-toolbar-btn--exit"
                  onClick={() => setShowEditor(false)}
                  title="Exit editor"
                >
                  <Icon name="close" size={10} />
                  Exit
                </button>
              </div>
              {/* Editable area */}
              <div
                ref={editorRef}
                className="doc-editor"
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onPaste={(e) => {
                  // Strip rich-text markup — insert plain text only to prevent
                  // injected DOM elements (img, script, etc.) from landing in the
                  // editor and being preserved in the undo-history snapshots.
                  e.preventDefault();
                  const plain = e.clipboardData?.getData('text/plain') ?? '';
                  document.execCommand('insertText', false, plain);
                }}
                aria-label="Document editor"
                aria-multiline="true"
              />
            </div>
          ) : (
            <DocumentPane paper={paper} />
          )}
        </div>

        {/* ── Right pane ──────────────────────────────────────── */}
        <aside className="review-sidebar">
          {showEditor ? (
            /* ── Editor mode: suggestion list ── */
            <>
              <header className="review-sidebar-header">
                <div>
                  <p className="eyebrow">
                    <Icon name="edit" size={10} /> Fix Problems
                  </p>
                  <h3 className="review-sidebar-title">{paper.title}</h3>
                </div>
              </header>

              {suggestions.length === 0 ? (
                <p className="review-sidebar-empty">No suggestions found.</p>
              ) : (
                <div className="suggestion-list">
                  {suggestions.map((s) => (
                    <SuggestionCard
                      key={s.id}
                      suggestion={s}
                      active={activeSugId === s.id}
                      onHover={setActiveSugId}
                      onAccept={acceptSuggestion}
                      onSkip={skipSuggestion}
                      onFix={(x) => void fixSuggestion(x)}
                    />
                  ))}
                </div>
              )}

              <div className="review-actions-bar">
                <button
                  type="button"
                  className="review-run-btn review-run-btn--secondary"
                  onClick={undoEdit}
                  disabled={!canUndo}
                >
                  <Icon name="refresh" size={12} /> Undo last change
                </button>
                <button
                  type="button"
                  className="review-run-btn review-run-btn--secondary"
                  onClick={() => setShowEditor(false)}
                >
                  <Icon name="close" size={12} /> Exit editor
                </button>
              </div>
            </>
          ) : (
            /* ── Review mode: analysis panel ── */
            <>
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

              {/* Summary */}
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

              {/* Swarm agent list */}
              <div className="review-swarm-panel">
                <p className="review-swarm-label">
                  <Icon name="activity" size={10} />
                  Analysis Swarm
                  {anyRunning && <span className="review-swarm-running">running…</span>}
                  {allDone && review && <span className="review-swarm-done">complete</span>}
                </p>
                {liveAgents.map((agent) => {
                  const def = REVIEW_SWARM_AGENTS.find((d) => d.agentId === agent.agentId)!;
                  return <AgentSection key={agent.agentId} agent={agent} def={def} />;
                })}
              </div>

              {/* Strengths */}
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

              {/* Weaknesses */}
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

              {/* Footer */}
              {review && (
                <p className="review-sidebar-footer">
                  Reviewed by {review.modelUsed} · {new Date(review.reviewedAt).toLocaleString()}
                </p>
              )}

              {/* Actions */}
              <div className="review-actions-bar">
                {!review && !reviewStreaming && (
                  <button
                    type="button"
                    className="review-run-btn"
                    onClick={() => void runReview()}
                  >
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
                      onClick={enterEditor}
                    >
                      <Icon name="edit" size={13} /> Fix Problems
                    </button>
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
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
