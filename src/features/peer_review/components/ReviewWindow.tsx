import { useRef, useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { usePeerReviewStore, type AgentReviewResult, type ReviewedPaper } from '@core/store/peerReviewStore';
import type { EvidenceItem } from '@platform/index';
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
import { buildReviewReportMarkdown } from '../reviewReportMarkdown';
import { loadPdf } from '../pdfStore';
import { buildCitedClaims, sourcesForMarkers, type FaithfulnessGrade } from '../citationAudit';
import { gradeCitationFaithfulness, type CitationAudit, type FaithfulnessItem } from '../citationGrade';
import { REWRITE_REGISTERS, rewriteSelection, type RewriteRegister } from '../rewriteSelection';
import { askPaper, citedPassageNumbers, type PaperPassage } from '../askPaper';
import { continueWriting } from '../continueWriting';
import { downloadBlob } from '@features/brain/export/messageExport';
import { notify } from '@platform/notify';
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

function isSafeUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
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

// Display metadata for each faithfulness grade. `tone` drives the badge colour
// (green → red) and `glyph` is a compact one-character cue.
const FAITH_GRADE_META: Record<FaithfulnessGrade, { label: string; tone: string; glyph: string }> = {
  supported:    { label: 'Supported',    tone: 'ok',    glyph: '✓' },
  weak:         { label: 'Weak',         tone: 'weak',  glyph: '~' },
  overstated:   { label: 'Overstated',   tone: 'warn',  glyph: '↑' },
  unsupported:  { label: 'Unsupported',  tone: 'bad',   glyph: '?' },
  contradicted: { label: 'Contradicted', tone: 'bad',   glyph: '✕' },
  unassessed:   { label: 'Not assessed', tone: 'muted', glyph: '·' },
};

const FAITH_SUMMARY_ORDER: FaithfulnessGrade[] = [
  'supported', 'weak', 'overstated', 'unsupported', 'contradicted', 'unassessed',
];

/** One graded claim, with its cited source(s) revealed on click (verify). */
function FaithfulnessRow({ item, citations }: { item: FaithfulnessItem; citations: EvidenceItem[] }) {
  const meta = FAITH_GRADE_META[item.grade];
  const sources = sourcesForMarkers(item.markers, citations);
  return (
    <div className={`review-faith-row review-faith-row--${meta.tone}`}>
      <div className="review-faith-row-head">
        <span className={`review-faith-badge review-faith-badge--${meta.tone}`} title={meta.label}>
          <span aria-hidden="true">{meta.glyph}</span> {meta.label}
        </span>
        <span className="review-faith-markers">
          {item.markers.map((n) => `[${n}]`).join(' ')}
        </span>
      </div>
      <p className="review-faith-claim">{item.sentence}</p>
      {item.note && <p className="review-faith-note">{item.note}</p>}
      {sources.length > 0 && (
        <details className="review-faith-sources">
          <summary>Verify source{sources.length > 1 ? 's' : ''}</summary>
          {sources.map((s) => (
            <div className="review-faith-source" key={s.marker}>
              <p className="review-faith-source-title">
                <span className="review-faith-source-marker">[{s.marker}]</span> {s.title}
                {s.year ? ` · ${s.year}` : ''}
              </p>
              {s.snippet && <p className="review-faith-source-snippet">{s.snippet}</p>}
              <p className="review-faith-source-ids">
                {s.pmid && (
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${s.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PMID {s.pmid}
                  </a>
                )}
                {s.doi && (
                  <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">
                    doi:{s.doi}
                  </a>
                )}
                {!s.pmid && !s.doi && s.url && isSafeUrl(s.url) && (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    Source
                  </a>
                )}
              </p>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

/**
 * Citation-faithfulness card. Renders the grading result for a Brain manuscript
 * (every cited claim checked against the snippet it cites), or a clear
 * "cannot verify" note for an uploaded document with no source records.
 */
function CitationFaithfulnessCard({
  audit,
  citations,
  hasSources,
  streaming,
}: {
  audit?: CitationAudit;
  citations: EvidenceItem[];
  hasSources: boolean;
  streaming: boolean;
}) {
  if (!hasSources) {
    return (
      <div className="review-faith-block">
        <p className="review-bullets-label review-faith-label">Citation Faithfulness</p>
        <p className="review-faith-empty">
          Citations could not be verified — this document carries no source records to
          check claims against.
        </p>
      </div>
    );
  }
  if (!audit) {
    if (streaming) {
      return (
        <div className="review-faith-block">
          <p className="review-bullets-label review-faith-label">Citation Faithfulness</p>
          <p className="review-faith-empty">Checking cited claims against their sources…</p>
        </div>
      );
    }
    return null;
  }
  return (
    <div className="review-faith-block">
      <p className="review-bullets-label review-faith-label">Citation Faithfulness</p>
      <div className="review-faith-summary">
        {FAITH_SUMMARY_ORDER.filter((g) => audit.counts[g] > 0).map((g) => {
          const meta = FAITH_GRADE_META[g];
          return (
            <span
              key={g}
              className={`review-faith-chip review-faith-chip--${meta.tone}`}
              title={meta.label}
            >
              {meta.label} {audit.counts[g]}
            </span>
          );
        })}
        <span className="review-faith-checked">{audit.checked} claim{audit.checked === 1 ? '' : 's'} checked</span>
      </div>
      <div className="review-faith-list">
        {audit.items.map((item, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: claims are a static, ordered list
          <FaithfulnessRow key={i} item={item} citations={citations} />
        ))}
      </div>
    </div>
  );
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

// Rasterised PDF preview for uploaded papers. pdf.js is dynamically imported
// on first use, so it stays out of the main bundle. Falls back to the
// extracted-text view if rendering fails.
function PdfCanvasPreview({ url, paper }: { url: string; paper: ReviewedPaper }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    host.replaceChildren();
    setStatus('loading');
    void (async () => {
      try {
        const { renderPdfToCanvases } = await import('../pdfRender');
        await renderPdfToCanvases(url, host, () => cancelled);
        if (!cancelled) setStatus('ready');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (status === 'error') {
    // Rendering failed — fall back to the pre-built HTML preview (manuscripts,
    // in a sandboxed iframe) or the extracted text (uploaded PDFs), so the paper
    // is still usable.
    if (paper.htmlContent) {
      return <iframe srcDoc={paper.htmlContent} title={paper.title} className="review-pdf-frame" sandbox="" />;
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

  return (
    <div className="review-pdf-canvas-pane">
      {status === 'loading' && <div className="review-pdf-loading">Rendering PDF…</div>}
      <div ref={hostRef} className="review-pdf-canvas-host" aria-label={`${paper.title} preview`} />
    </div>
  );
}

// Resolve a usable PDF object URL: the live session blob if present, otherwise
// one rebuilt from the bytes persisted in IndexedDB so the preview survives an
// app restart. `enabled` skips the load when the PDF is not needed.
function usePdfObjectUrl(paper: ReviewedPaper, enabled: boolean): { url: string | null; loading: boolean } {
  const [state, setState] = useState<{ url: string | null; loading: boolean }>(
    paper.blobUrl ? { url: paper.blobUrl, loading: false } : { url: null, loading: enabled },
  );
  useEffect(() => {
    if (paper.blobUrl) {
      setState({ url: paper.blobUrl, loading: false });
      return;
    }
    if (!enabled) {
      setState({ url: null, loading: false });
      return;
    }
    let created: string | null = null;
    let cancelled = false;
    setState({ url: null, loading: true });
    void loadPdf(paper.id).then((blob) => {
      if (cancelled) return;
      if (blob) {
        created = URL.createObjectURL(blob);
        setState({ url: created, loading: false });
      } else {
        setState({ url: null, loading: false });
      }
    });
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [paper.id, paper.blobUrl, enabled]);
  return state;
}

function DocumentPane({ paper }: { paper: ReviewedPaper }) {
  const { url: pdfUrl, loading: pdfLoading } = usePdfObjectUrl(paper, !paper.editedHtml);
  if (paper.editedHtml) {
    return (
      <div className="review-document-preview">
        <article
          className="review-document-page"
          // Editor output is produced by this component. Paste is forced to
          // plain text, so stored markup is limited to toolbar formatting,
          // marks, and accepted-fix spans.
          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(paper.editedHtml) }}
        />
      </div>
    );
  }

  // Prefer the real typeset PDF so the in-app preview matches Brain mode and the
  // downloaded file exactly — both come from this same blob. WKWebView cannot
  // render a PDF blob inline in an iframe (it shows blank), so rasterise the pages
  // to canvases with pdf.js, the same renderer the Brain document preview uses.
  // Brain manuscripts carry both a blobUrl and htmlContent; uploaded PDFs carry
  // only a blobUrl. Either way the PDF is the source of truth here.
  if (pdfUrl) {
    return <PdfCanvasPreview url={pdfUrl} paper={paper} />;
  }

  // The PDF bytes are still being read back from IndexedDB after a restart —
  // show a brief placeholder rather than flashing the extracted-text fallback.
  if (pdfLoading) {
    return (
      <div className="review-pdf-canvas-pane">
        <div className="review-pdf-loading">Restoring PDF…</div>
      </div>
    );
  }

  // Fallback only when no PDF blob is available (e.g. the manuscript's PDF build
  // failed, or an older paper saved before PDFs were persisted): the pre-built
  // HTML preview in a sandboxed iframe.
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

interface AskEntry {
  question: string;
  answer: string;
  passages: PaperPassage[];
}

/**
 * Ask-this-paper panel. Questions are answered strictly from passages of the
 * document, cited with [P#] markers; each cited passage is revealed on click so
 * the answer is verifiable against the exact text it came from.
 */
function AskPaperPanel({ documentText }: { documentText: string }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<AskEntry[]>([]);

  const submit = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const { answer, passages } = await askPaper(agentModelFor('boss'), q, documentText);
      setEntries((prev) => [{ question: q, answer, passages }, ...prev]);
      setQuestion('');
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Ask failed: ${detail}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-ask-block">
      <p className="review-bullets-label review-ask-label">Ask this paper</p>
      <div className="review-ask-input">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Ask a question answered only from this document…"
          rows={2}
          aria-label="Ask this paper a question"
        />
        <button
          type="button"
          className="review-ask-send"
          onClick={() => void submit()}
          disabled={busy || question.trim().length === 0}
          data-busy={busy || undefined}
          aria-label="Ask"
        >
          {busy ? <Icon name="spinner" size={13} /> : <Icon name="send" size={13} />}
        </button>
      </div>
      {entries.map((entry, i) => {
        const cited = citedPassageNumbers(entry.answer)
          .map((n) => entry.passages.find((p) => p.index === n))
          .filter((p): p is PaperPassage => !!p);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only Q&A log
          <div className="review-ask-entry" key={i}>
            <p className="review-ask-q">{entry.question}</p>
            <p className="review-ask-a">{entry.answer}</p>
            {cited.length > 0 && (
              <details className="review-faith-sources">
                <summary>Verify passage{cited.length > 1 ? 's' : ''}</summary>
                {cited.map((p) => (
                  <div className="review-faith-source" key={p.index}>
                    <p className="review-faith-source-title">
                      <span className="review-faith-source-marker">[P{p.index}]</span>
                    </p>
                    <p className="review-faith-source-snippet">{p.text}</p>
                  </div>
                ))}
              </details>
            )}
          </div>
        );
      })}
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
