import { useRef, useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
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
} from '../reviewSwarm';
import { buildReviewReportPdf } from '../reviewReportPdf';
import { buildReviewReportMarkdown } from '../reviewReportMarkdown';
import { buildCitedClaims } from '../citationAudit';
import { gradeCitationFaithfulness } from '../citationGrade';
import { REWRITE_REGISTERS, rewriteSelection, type RewriteRegister } from '../rewriteSelection';
import { continueWriting } from '../continueWriting';
import { downloadBlob } from '@platform/download';
import { notify } from '@platform/notify';
import { streamWithModelSafe } from '@core/llm/ProviderRegistry';
import {
  currentDocumentText,
  buildHighlightedHtml,
  replaceFirstPlainText,
  markFirstPlainText,
} from './editorHtml';
import { ScoreRing, CitationFaithfulnessCard, AgentSection } from './ReviewResultCards';
import { DocumentPane } from './DocumentPane';
import { SuggestionCard } from './SuggestionCard';
import { AskPaperPanel } from './AskPaperPanel';

type HistoryEntry = { html: string; sugs: Suggestion[] };

export function ReviewWindow({ paper, onClose }: { paper: ReviewedPaper; onClose: () => void }) {
  const setReview          = usePeerReviewStore((s) => s.setReview);
  const setReviewStreaming = usePeerReviewStore((s) => s.setReviewStreaming);
  const setReviewError     = usePeerReviewStore((s) => s.setReviewError);
  const setReviewAgents    = usePeerReviewStore((s) => s.setReviewAgents);
  const patchReviewAgent   = usePeerReviewStore((s) => s.patchReviewAgent);
  const setCitationAudit   = usePeerReviewStore((s) => s.setCitationAudit);
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
  const [rewriteBusy, setRewriteBusy] = useState<RewriteRegister | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);

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
    editorRef.current.innerHTML = DOMPurify.sanitize(
      paper.editedHtml ??
        buildHighlightedHtml(
          enterDataRef.current.text,
          enterDataRef.current.sugs,
        ),
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
    // Defense-in-depth: sanitize on restore as well as on entry, so a snapshot
    // can never reintroduce unsafe markup into the editor.
    editorRef.current.innerHTML = DOMPurify.sanitize(prev.html);
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

  // Rewrite the highlighted passage in a chosen register. Citation markers are
  // preserved — if the model alters them the rewrite is rejected so no claim
  // ever loses (or gains) its source.
  const rewriteSelected = async (register: RewriteRegister) => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      useToastStore.getState().show('Select a sentence or passage to rewrite first.', 'info');
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      useToastStore.getState().show('Select text inside the document to rewrite.', 'info');
      return;
    }
    const passage = selection.toString().trim();
    if (passage.length < 3) {
      useToastStore.getState().show('Select a longer passage to rewrite.', 'info');
      return;
    }
    if (passage.length > 4000) {
      useToastStore.getState().show('That selection is too long — rewrite a paragraph at a time.', 'info');
      return;
    }
    const savedRange = range.cloneRange();
    setRewriteBusy(register);
    try {
      const { text, markersOk } = await rewriteSelection(agentModelFor('boss'), passage, register);
      if (!text) {
        useToastStore.getState().show('The rewrite came back empty.', 'info');
        return;
      }
      if (!markersOk) {
        useToastStore.getState().show('Rewrite changed a citation — kept the original.', 'error');
        return;
      }
      // Restore the selection (lost across the await) and replace it in place,
      // routed through execCommand so the editor's native undo stack records it.
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
      editor.focus();
      saveHistory();
      document.execCommand('insertText', false, text);
      persistEditor();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Rewrite failed: ${detail}`, 'error');
    } finally {
      setRewriteBusy(null);
    }
  };

  // Continue writing from the cursor (or the end), grounded only in the paper's
  // own retrieved sources, inserting [n] markers. No sources → nothing to ground
  // a claim in, so the action is disabled.
  const continueFromCursor = async () => {
    const editor = editorRef.current;
    const citations = paper.citations ?? [];
    if (!editor) return;
    if (citations.length === 0) {
      useToastStore.getState().show('No retrieved sources to ground a continuation.', 'info');
      return;
    }
    const selection = window.getSelection();
    let savedRange: Range | null = null;
    let preceding = editor.innerText;
    if (selection && selection.rangeCount > 0 && editor.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      const caret = selection.getRangeAt(0);
      savedRange = caret.cloneRange();
      const pre = document.createRange();
      pre.setStart(editor, 0);
      pre.setEnd(caret.endContainer, caret.endOffset);
      preceding = pre.toString();
    }
    setContinueBusy(true);
    try {
      const { text } = await continueWriting(agentModelFor('boss'), preceding, citations);
      if (!text) {
        useToastStore.getState().show('No grounded continuation could be added.', 'info');
        return;
      }
      const needsSpace = preceding.length > 0 && !/\s$/.test(preceding);
      const insert = needsSpace ? ` ${text}` : text;
      const sel = window.getSelection();
      if (savedRange && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange);
      } else {
        editor.focus();
        const end = document.createRange();
        end.selectNodeContents(editor);
        end.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(end);
      }
      editor.focus();
      saveHistory();
      document.execCommand('insertText', false, insert);
      persistEditor();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Continue failed: ${detail}`, 'error');
    } finally {
      setContinueBusy(false);
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

      await streamWithModelSafe(
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
      void notify('Peer review complete', `"${paper.title.slice(0, 60)}" is ready for review.`);

      // Citation-faithfulness pass — verify each [n] claim against the snippet
      // it cites. Only runs for documents that carry source records (Brain
      // manuscripts); uploaded PDFs have no snippets, so it is skipped and the
      // UI shows a "could not verify" note instead.
      const claims = buildCitedClaims(currentDocumentText(paper), paper.citations ?? []);
      if (claims.length > 0 && !controller.signal.aborted) {
        try {
          const audit = await gradeCitationFaithfulness(model, claims, controller.signal);
          if (!controller.signal.aborted) setCitationAudit(paper.id, audit);
        } catch (err) {
          if ((err as Error)?.name !== 'AbortError') {
            // Non-fatal: the swarm review still stands without the audit.
            const detail = err instanceof Error ? err.message : String(err);
            useToastStore.getState().show(`Citation check skipped: ${detail}`, 'info');
          }
        }
      }
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

  const exportMarkdown = () => {
    if (!paper.review) return;
    setExportBusy(true);
    try {
      const md = buildReviewReportMarkdown(paper);
      const slug = paper.title.slice(0, 48).replace(/\s+/g, '-').toLowerCase();
      downloadBlob(`${slug}-peer-review.md`, new Blob([md], { type: 'text/markdown' }));
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
                <div className="doc-toolbar-group doc-toolbar-rewrite">
                  <span className="doc-toolbar-rewrite-label">Rewrite</span>
                  {REWRITE_REGISTERS.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      className="doc-toolbar-btn doc-toolbar-btn--rewrite"
                      onClick={() => void rewriteSelected(r.value)}
                      disabled={rewriteBusy !== null}
                      title={`${r.hint} (rewrites the selected text, keeping citations)`}
                    >
                      {rewriteBusy === r.value ? <Icon name="spinner" size={11} /> : r.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="doc-toolbar-btn doc-toolbar-btn--rewrite"
                    onClick={() => void continueFromCursor()}
                    disabled={continueBusy || (paper.citations?.length ?? 0) === 0}
                    title={
                      (paper.citations?.length ?? 0) === 0
                        ? 'No retrieved sources to ground a continuation'
                        : 'Continue writing from the cursor, grounded in this paper’s sources'
                    }
                  >
                    {continueBusy ? <Icon name="spinner" size={11} /> : 'Continue'}
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

              {/* Ask this paper — grounded Q&A over the document text */}
              <AskPaperPanel documentText={currentDocumentText(paper)} />

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
                  // Guard against an unknown agentId: a missing def would crash
                  // the render through the old non-null assertion.
                  const def = REVIEW_SWARM_AGENTS.find((d) => d.agentId === agent.agentId);
                  if (!def) return null;
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

              {/* Citation faithfulness — every cited claim checked against its source */}
              {review && (
                <CitationFaithfulnessCard
                  {...(paper.citationAudit ? { audit: paper.citationAudit } : {})}
                  citations={paper.citations ?? []}
                  hasSources={(paper.citations?.length ?? 0) > 0}
                  streaming={reviewStreaming ?? false}
                />
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
                      onClick={exportMarkdown}
                      disabled={exportBusy}
                    >
                      <Icon name="download" size={13} /> Export Markdown
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
