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

function currentDocumentText(paper: ReviewedPaper): string {
  return paper.editedText ?? paper.text;
}

function textToPreviewHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return '<p></p>';
  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
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

function firstTextNodeContaining(root: HTMLElement, needle: string): Text | null {
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent ?? '').includes(needle)) return node as Text;
    node = walker.nextNode();
  }
  return null;
}

function replaceFirstPlainText(root: HTMLElement, needle: string, replacement: string, className: string): boolean {
  const node = firstTextNodeContaining(root, needle);
  if (!node) return false;
  const text = node.textContent ?? '';
  const index = text.indexOf(needle);
  if (index < 0) return false;
  const before = document.createTextNode(text.slice(0, index));
  const after = document.createTextNode(text.slice(index + needle.length));
  const span = document.createElement('span');
  span.className = className;
  span.textContent = replacement;
  node.replaceWith(before, span, after);
  return true;
}

function markFirstPlainText(
  root: HTMLElement,
  needle: string,
  sid: string,
  type: SuggestionType,
): boolean {
  const node = firstTextNodeContaining(root, needle);
  if (!node) return false;
  const text = node.textContent ?? '';
  const index = text.indexOf(needle);
  if (index < 0) return false;
  const before = document.createTextNode(text.slice(0, index));
  const after = document.createTextNode(text.slice(index + needle.length));
  const mark = document.createElement('mark');
  mark.className = `doc-mark doc-mark--${type}`;
  mark.dataset.sid = sid;
  mark.textContent = needle;
  node.replaceWith(before, mark, after);
  return true;
}

// ── Review panel sub-components ───────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const tier = score >= 8 ? 'high' : score >= 5 ? 'mid' : 'low';
  const safeScore = Math.max(1, Math.min(10, score));
  const radius = 19;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - safeScore / 10);
  return (
    <div className="review-score-ring" data-tier={tier}>
      <svg className="review-score-svg" viewBox="0 0 44 44" aria-hidden="true">
        <circle className="review-score-track" cx="22" cy="22" r={radius} />
        <circle
          className="review-score-progress"
          cx="22"
          cy="22"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="review-score-value">
        <span className="review-score-number">{safeScore}</span>
        <span className="review-score-denom">/10</span>
      </span>
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
  const hasContent = agent.items.length > 0 || agent.text.trim().length > 0 || Boolean(agent.error);

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

function DocumentPane({ paper }: { paper: ReviewedPaper }) {
  if (paper.editedHtml) {
    return (
      <div className="review-document-preview">
        <article
          className="review-document-page"
          // Editor output is produced by this component. Paste is forced to
          // plain text, so stored markup is limited to toolbar formatting,
          // marks, and accepted-fix spans.
          dangerouslySetInnerHTML={{ __html: paper.editedHtml }}
        />
      </div>
    );
  }

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

  return (
    <div className="review-document-preview">
      <article
        className="review-document-page"
        dangerouslySetInnerHTML={{ __html: textToPreviewHtml(currentDocumentText(paper).slice(0, 120_000)) }}
      />
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
  const setDocumentDraft   = usePeerReviewStore((s) => s.setDocumentDraft);

  const abortRef      = useRef<AbortController | null>(null);
  const editorRef     = useRef<HTMLDivElement | null>(null);
  const historyRef    = useRef<HistoryEntry[]>([]);
  // Capture text + suggestions at the moment of entering editor mode
  const enterDataRef  = useRef<{ text: string; sugs: Suggestion[] }>({ text: '', sugs: [] });

  const [exportBusy,  setExportBusy]  = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeSugId, setActiveSugId] = useState<string | null>(null);
  const [showEditor,  setShowEditor]  = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);

  const liveAgents: AgentReviewResult[] =
    paper.reviewAgents ??
    paper.review?.agentResults ??
    initialSwarmAgents();

  const persistEditor = () => {
    if (!editorRef.current) return;
    setDocumentDraft(paper.id, editorRef.current.innerText, editorRef.current.innerHTML);
  };

  // ── Editor init ────────────────────────────────────────────────────────
  // Build the highlighted HTML when the editor first opens.
  // Uses captured ref values so we don't re-run on suggestion state changes.
  useEffect(() => {
    if (!showEditor || !editorRef.current) return;
    editorRef.current.innerHTML = paper.editedHtml ??
      buildHighlightedHtml(
        enterDataRef.current.text,
        enterDataRef.current.sugs,
      );
    historyRef.current = [];
    setHistoryVersion((v) => v + 1);
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
    setHistoryVersion((v) => v + 1);
  };

  const undoEdit = () => {
    if (!editorRef.current || historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    editorRef.current.innerHTML = prev.html;
    setSuggestions(prev.sugs);
    setHistoryVersion((v) => v + 1);
    persistEditor();
  };

  const runEditorCommand = (command: string, value?: string) => {
    if (!editorRef.current) return;
    saveHistory();
    editorRef.current.focus();
    document.execCommand(command, false, value);
    persistEditor();
  };

  const copyEditorText = async () => {
    if (!editorRef.current) return;
    try {
      await navigator.clipboard.writeText(editorRef.current.innerText);
      useToastStore.getState().show('Document text copied', 'info');
    } catch {
      useToastStore.getState().show('Copy failed', 'error');
    }
  };

  // ── Suggestion actions ─────────────────────────────────────────────────

  const acceptSuggestion = (s: Suggestion) => {
    if (!editorRef.current) return;
    const mark = editorRef.current.querySelector<HTMLElement>(`mark[data-sid="${s.id}"]`);
    let applied = false;
    if (mark) {
      // Anchored suggestion: replace the <mark> in-place
      saveHistory();
      const span = document.createElement('span');
      span.className = 'doc-fix-accepted';
      span.textContent = s.suggestedText;
      mark.replaceWith(span);
      applied = true;
    } else if (s.originalText && s.suggestedText) {
      saveHistory();
      applied = replaceFirstPlainText(editorRef.current, s.originalText, s.suggestedText, 'doc-fix-accepted');
      if (!applied) {
        historyRef.current.pop();
        setHistoryVersion((v) => v + 1);
      }
    }
    if (!applied) {
      useToastStore.getState().show('Could not locate that passage in the editable document', 'error');
      return;
    }
    persistEditor();
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
    persistEditor();
    setSuggestions((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, status: 'skipped' } : x)),
    );
  };

  const fixSuggestion = async (s: Suggestion) => {
    setSuggestions((prev) =>
      prev.map((x) => (x.id === s.id ? { ...x, status: 'fixing' } : x)),
    );
    try {
      const rawText   = editorRef.current?.innerText ?? currentDocumentText(paper);
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
        markFirstPlainText(editorRef.current, newOriginal, s.id, s.type);
        persistEditor();
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
    enterDataRef.current = { text: currentDocumentText(paper), sugs: parsed };
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
        currentDocumentText(paper),
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
  const canUndo      = historyVersion >= 0 && historyRef.current.length > 0;

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
                <div className="doc-toolbar-group doc-toolbar-group--wide">
                  <select
                    className="doc-toolbar-select"
                    defaultValue="P"
                    title="Paragraph style"
                    aria-label="Paragraph style"
                    onChange={(e) => runEditorCommand('formatBlock', e.currentTarget.value)}
                  >
                    <option value="P">Paragraph</option>
                    <option value="H2">Heading</option>
                    <option value="H3">Subheading</option>
                    <option value="BLOCKQUOTE">Quote</option>
                  </select>
                  <select
                    className="doc-toolbar-select doc-toolbar-select--size"
                    defaultValue="3"
                    title="Text size"
                    aria-label="Text size"
                    onChange={(e) => runEditorCommand('fontSize', e.currentTarget.value)}
                  >
                    <option value="2">Small</option>
                    <option value="3">Normal</option>
                    <option value="4">Large</option>
                    <option value="5">Title</option>
                  </select>
                </div>
                <div className="doc-toolbar-group">
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('bold')} title="Bold" aria-label="Bold">
                    <strong>B</strong>
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('italic')} title="Italic" aria-label="Italic">
                    <em>I</em>
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('underline')} title="Underline" aria-label="Underline">
                    <span className="doc-toolbar-u">U</span>
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('strikeThrough')} title="Strikethrough" aria-label="Strikethrough">
                    <span className="doc-toolbar-s">S</span>
                  </button>
                </div>
                <div className="doc-toolbar-group">
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('insertUnorderedList')} title="Bulleted list" aria-label="Bulleted list">
                    <Icon name="list" size={13} />
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('insertOrderedList')} title="Numbered list" aria-label="Numbered list">
                    1.
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('outdent')} title="Outdent" aria-label="Outdent">
                    <Icon name="minus" size={13} />
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('indent')} title="Indent" aria-label="Indent">
                    <Icon name="plus" size={13} />
                  </button>
                </div>
                <div className="doc-toolbar-group">
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('justifyLeft')} title="Align left" aria-label="Align left">
                    L
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('justifyCenter')} title="Align center" aria-label="Align center">
                    C
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('justifyRight')} title="Align right" aria-label="Align right">
                    R
                  </button>
                  <button type="button" className="doc-toolbar-btn doc-toolbar-btn--icon" onClick={() => runEditorCommand('removeFormat')} title="Clear formatting" aria-label="Clear formatting">
                    <Icon name="close" size={12} />
                  </button>
                </div>
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
                  aria-label="Undo"
                >
                  <Icon name="refresh" size={11} />
                </button>
                <button
                  type="button"
                  className="doc-toolbar-btn"
                  onClick={() => void copyEditorText()}
                  title="Copy document text"
                  aria-label="Copy document text"
                >
                  <Icon name="copy" size={11} />
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
                spellCheck
                onInput={persistEditor}
                onPaste={(e) => {
                  // Strip rich-text markup — insert plain text only to prevent
                  // injected DOM elements (img, script, etc.) from landing in the
                  // editor and being preserved in the undo-history snapshots.
                  e.preventDefault();
                  saveHistory();
                  const plain = e.clipboardData?.getData('text/plain') ?? '';
                  document.execCommand('insertText', false, plain);
                  persistEditor();
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
                      <Icon name="filePdf" size={13} />
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
