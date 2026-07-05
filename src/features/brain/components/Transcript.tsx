import { memo, useEffect, useRef, useState } from 'react';
import logoMark from '@/assets/logo-mark.png';

const MESSAGE_CAP = 80;

// Only allow http / https URLs in evidence anchors — blocks javascript: and
// data: URIs that a compromised biomedical API could return.
function isSafeUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}
import type { EvidenceItem } from '@platform/index';
import type { ChatMessage } from '@core/store/chatHistoryStore';
import { useToastStore } from '@core/store/toastStore';
import { usePeerReviewStore } from '@core/store/peerReviewStore';
import { useModeStore } from '@core/store/modeStore';
import { manuscriptToReadableText } from '../swarm/manuscript';
import { findSupportingSpans } from '../swarm/citationSpans';
import { Icon } from '@ui/icons';
import { PdfGlyph } from '@ui/icons/PdfGlyph';
import { MarkdownText } from '@ui/MarkdownText';
import {
  buildExportHtml,
  buildMarkdownExport,
  buildMessagePdfBlob,
  deriveDocumentTitle,
  exportMessageDocx,
  renumberCitations,
  slugifyFilename,
  stripGeneratedReferenceSections,
  stripResidualSourceMarkers,
  type ExportableMessage,
} from '../export/messageExport';
import { exportMessageLatex } from '../export/latexExport';
import { DocumentPreviewWindow, type PreviewDocument } from './DocumentPreviewWindow';
import { InteractionMatrix } from './InteractionMatrix';
import { InteractionReportBody } from './InteractionReportBody';
import { interactionMatrixFromReport, interactionMatrixMarkdown } from '../swarm/interactionMatrix';

export type { ChatMessage };

function evidenceKey(item: EvidenceItem, index: number) {
  return item.provenanceHash || `${item.source}-${item.title}-${index}`;
}

function isRetracted(item: EvidenceItem): boolean {
  return item.identifiers?.retracted === 'true';
}

function DocumentArtifactCard({
  title,
  typeLabel,
  referenceCount,
  onOpen,
  onReview,
}: {
  title: string;
  typeLabel: string;
  referenceCount: number;
  onOpen: () => void;
  onReview: () => void;
}) {
  return (
    <div className="document-artifact-card">
      <button type="button" className="document-artifact-main" onClick={onOpen}>
        <span className="document-artifact-icon" aria-hidden="true">
          <PdfGlyph size={30} />
        </span>
        <span className="document-artifact-meta">
          <strong>{title}</strong>
          <span>{typeLabel}{referenceCount > 0 ? ` · ${referenceCount} references` : ''}</span>
        </span>
        <Icon name="eye" size={14} />
      </button>
      <button type="button" className="document-artifact-review" onClick={onReview} title="Open in Peer Review">
        <Icon name="shield" size={13} /> Review
      </button>
    </div>
  );
}

const READY_PROMPTS = [
  'Summarize the latest RCTs on GLP-1 receptor agonists in obesity and type 2 diabetes',
  'What is the current evidence on statin therapy for primary cardiovascular prevention?',
  'Review meta-analyses on antibiotic stewardship strategies in ICU patients',
  'Analyze anticoagulation risk-benefit in atrial fibrillation among elderly patients',
  'Compare SGLT-2 inhibitors in heart failure with reduced vs preserved ejection fraction',
  'What do recent Cochrane reviews conclude on antidepressant efficacy vs placebo?',
];

// Example interaction queries shown on the Drug-Interactions home screen.
const DI_PROMPTS = [
  'Warfarin and grapefruit juice',
  'Ibuprofen with lisinopril and hydrochlorothiazide',
  'Simvastatin and clarithromycin',
  'Sertraline and tramadol',
  'Methotrexate and trimethoprim',
  'Clopidogrel and omeprazole',
];

const GENE_PROMPTS = [
  'MICA TT genotype and cardiovascular complications in type 1 diabetes',
  'APOE e4 allele and Alzheimer disease',
  'Factor V Leiden and venous thromboembolism',
  'rs1051792 and autoimmune disease',
  'TCF7L2 variant and type 2 diabetes',
  'HLA-B27 and ankylosing spondylitis',
];

function EmptyState({
  onSelect,
  drugFocus,
  geneticsFocus,
}: {
  onSelect: (prompt: string) => void;
  drugFocus?: boolean;
  geneticsFocus?: boolean;
}) {
  if (geneticsFocus) {
    return (
      <div className="brain-empty-state gene-empty">
        <div className="brain-empty-brand">
          <span className="gene-empty-mark" aria-hidden="true">
            <Icon name="dna" size={30} />
          </span>
          <h2 className="brain-empty-title">Genetics</h2>
          <p className="brain-empty-sub">
            Gene variant × disease → an association-confidence score from trusted genetic databases
          </p>
        </div>
        <div className="brain-empty-prompts">
          {GENE_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" className="brain-prompt-chip" onClick={() => onSelect(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (drugFocus) {
    return (
      <div className="brain-empty-state di-empty">
        <div className="brain-empty-brand">
          <span className="di-empty-mark" aria-hidden="true">
            <Icon name="pill" size={30} />
          </span>
          <h2 className="brain-empty-title">Pharmacist</h2>
          <p className="brain-empty-sub">Grade any combination A–X from trusted label &amp; literature sources</p>
        </div>
        <div className="brain-empty-prompts">
          {DI_PROMPTS.map((prompt) => (
            <button key={prompt} type="button" className="brain-prompt-chip" onClick={() => onSelect(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const maskStyle = { WebkitMaskImage: `url(${logoMark})`, maskImage: `url(${logoMark})` } as React.CSSProperties;
  return (
    <div className="brain-empty-state">
      <div className="brain-empty-brand">
        <span className="brain-empty-logo-mark" style={maskStyle} aria-hidden="true" />
        <h2 className="brain-empty-title">HashCerebrum</h2>
        <p className="brain-empty-sub">Medical AI research swarm</p>
      </div>
      <div className="brain-empty-prompts">
        {READY_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            className="brain-prompt-chip"
            onClick={() => onSelect(prompt)}
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

export const Transcript = memo(function Transcript({
  messages,
  modelLabel,
  onCritique,
  onRegenerate,
  onEdit,
  onDraftOutline,
  onPromptSelect,
  drugFocus,
  geneticsFocus,
}: {
  messages: ChatMessage[];
  modelLabel: string;
  isRunning: boolean;
  onCritique?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string) => void;
  onDraftOutline?: (query: string) => void;
  onPromptSelect?: (prompt: string) => void;
  drugFocus?: boolean;
  geneticsFocus?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewDocument | null>(null);
  const [showAll, setShowAll] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether the view is "pinned" to the bottom. We only auto-follow new
  // content while pinned, so scrolling up to read scrollback is never
  // interrupted by an incoming answer.
  const pinnedRef = useRef(true);
  // Coalesces auto-follow scrolls to one per animation frame.
  const followRafRef = useRef<number | null>(null);

  const hasUserMessage = messages.some((m) => m.role === 'user');
  const capped = !showAll && messages.length > MESSAGE_CAP;
  const visibleMessages = capped ? messages.slice(messages.length - MESSAGE_CAP) : messages;
  const baseIndex = capped ? messages.length - MESSAGE_CAP : 0;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Auto-follow the bottom while streaming. Setting scrollTop synchronously on
  // every token thrashes layout and stutters in WKWebView, so defer to the next
  // frame (lands after the new content is laid out) and coalesce a burst of
  // streaming updates into a single scroll. Re-check pinnedRef inside the frame
  // so a scroll-up that happens before the frame runs is respected, not undone.
  useEffect(() => {
    if (!pinnedRef.current) return;
    if (followRafRef.current !== null) cancelAnimationFrame(followRafRef.current);
    followRafRef.current = requestAnimationFrame(() => {
      followRafRef.current = null;
      const el = scrollRef.current;
      if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
  }, [messages]);

  useEffect(
    () => () => {
      if (followRafRef.current !== null) cancelAnimationFrame(followRafRef.current);
    },
    [],
  );

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const copyMessage = async (message: ChatMessage) => {
    // Never put internal source markers ([S#], 【S#】) on the clipboard.
    const text = stripResidualSourceMarkers(message.content);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedId(message.id);
      copyTimerRef.current = setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1200);
    } catch {
      setCopiedId(null);
    }
  };

  const titleFor = (message: ChatMessage, index: number) =>
    deriveDocumentTitle(message.content, `HashCerebrum message ${index + 1}`);

  const exportableFor = (message: ChatMessage, index: number): ExportableMessage => {
    // In Drug-Interactions mode, prepend the interaction-overview matrix as a
    // Markdown table so the exported PDF / Word / Markdown carries the table as
    // well as the cards — the same "table + report" the user sees on screen.
    let content = message.content;
    if (drugFocus) {
      const matrix = interactionMatrixFromReport(message.content);
      if (matrix) content = `${interactionMatrixMarkdown(matrix)}\n${content}`;
    }
    return {
      title: titleFor(message, index),
      role: message.role,
      content,
      modelLabel: message.modelLabel ?? modelLabel,
      ...(message.citations ? { citations: message.citations } : {}),
      ...(message.manuscript ? { manuscript: message.manuscript } : {}),
    };
  };

  const openPdfPreview = async (message: ChatMessage, index: number) => {
    const exportable = exportableFor(message, index);
    const title = exportable.title;
    // Build beautiful HTML for the preview first — this is synchronous and
    // always succeeds.  Tauri's WKWebView cannot render PDF blobs inline, so
    // the srcDoc path is the reliable display route for all host environments.
    const htmlContent = buildExportHtml(exportable);
    // Then attempt the PDF blob for the download button.  If PDF generation
    // fails (Typst unavailable, jsPDF error) we fall back to an HTML blob so
    // the user can still save the document.
    let blob: Blob;
    let filename: string;
    try {
      blob = await buildMessagePdfBlob(exportable);
      filename = `${slugifyFilename(title)}.pdf`;
    } catch {
      blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
      filename = `${slugifyFilename(title)}.html`;
      useToastStore.getState().show('PDF generation failed — saved as HTML', 'info');
    }
    setPreview({
      title,
      filename,
      kind: 'pdf',
      typeLabel: message.manuscript ? 'Research manuscript' : 'Research result',
      blob,
      htmlContent,
      copyText: stripResidualSourceMarkers(stripGeneratedReferenceSections(message.content)),
    });
  };

  const sendToReview = async (message: ChatMessage, index: number) => {
    const exportable = exportableFor(message, index);
    const rawText = message.manuscript
      ? manuscriptToReadableText(message.manuscript)
      : message.content;
    // Renumber [S#] → sequential [n] and return the cited records in that same
    // order, so reviewers read clean markers AND the citation-faithfulness pass
    // can map each [n] claim to the snippet it cites.
    const renumbered = renumberCitations(stripGeneratedReferenceSections(rawText), message.citations ?? []);
    const text = renumbered.content;
    // HTML preview is always available (no async, no failure path).
    const htmlContent = buildExportHtml(exportable);
    // PDF blob is optional — review still works from text alone.
    let pdfBlob: Blob | undefined;
    try {
      pdfBlob = await buildMessagePdfBlob(exportable);
    } catch {
      // PDF optional
    }
    usePeerReviewStore.getState().addManuscript(exportable.title, text, pdfBlob, htmlContent, renumbered.citations);
    useModeStore.getState().setMode('peer_review');
  };

  const openMarkdownPreview = (message: ChatMessage, index: number) => {
    const exportable = exportableFor(message, index);
    const body = buildMarkdownExport(exportable);
    setPreview({
      title: exportable.title,
      filename: `${slugifyFilename(exportable.title)}.md`,
      kind: 'markdown',
      typeLabel: 'Markdown document',
      blob: new Blob([body], { type: 'text/markdown;charset=utf-8' }),
      copyText: body,
    });
  };

  return (
    <>
      <div className="transcript chat-scroll" aria-live="polite" ref={scrollRef} onScroll={handleScroll}>
        {!hasUserMessage && onPromptSelect && (
          <EmptyState onSelect={onPromptSelect} drugFocus={drugFocus ?? false} geneticsFocus={geneticsFocus ?? false} />
        )}
        {capped && (
          <button
            type="button"
            className="transcript-load-more"
            onClick={() => setShowAll(true)}
          >
            Load {messages.length - MESSAGE_CAP} earlier messages
          </button>
        )}
        {visibleMessages.map((message, index) => {
          const actualIndex = baseIndex + index;
          const title = titleFor(message, actualIndex);
          const isAi = message.role === 'assistant';
          const isUser = message.role === 'user';
          const isSystem = message.role === 'system';
          // A Drug-Interactions report carries cited evidence too, but it is a
          // clinical answer to be read inline (graded cards + the interaction
          // matrix), not a manuscript to open as a document — so never treat it
          // as a document, or the inline matrix branch is skipped.
          const isDocument =
            isAi &&
            !message.isStreaming &&
            !drugFocus &&
            (!!message.manuscript || (message.citations?.length ?? 0) > 0);
          const who = isAi ? (message.modelLabel ?? modelLabel) : isUser ? 'Researcher' : 'Workspace';
          const maskStyle = { WebkitMaskImage: `url(${logoMark})`, maskImage: `url(${logoMark})` } as React.CSSProperties;
          // System messages: show empty state before first user turn, hide after.
          if (isSystem) return null;

          return (
            <div key={message.id} className={`msg ${isAi ? 'ai' : 'user'}`} data-error={!!message.error || undefined}>
              <div className="avatar">
                {isAi ? (
                  <span className="ai-mark logo-mask" style={maskStyle} aria-hidden="true" />
                ) : (
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                    <circle cx="14" cy="14" r="13.5" fill="var(--ink-3)" stroke="var(--line-strong)" strokeWidth="1" />
                    <g stroke="var(--text-2)" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="none">
                      <circle cx="14" cy="11.5" r="3.3" />
                      <path d="M7 23 Q9.4 17.5 14 17.5 Q18.6 17.5 21 23" />
                    </g>
                  </svg>
                )}
              </div>
              <div className="msg-content">
                <div className="msg-head">
                  <span className="who">{who}</span>
                  {message.failoverNote && <span className="chat-failover">{message.failoverNote}</span>}
                </div>
                <div className="msg-body">
                  {isDocument ? (
                    <DocumentArtifactCard
                      title={title}
                      typeLabel={message.manuscript ? 'Research manuscript' : 'Research result'}
                      referenceCount={message.citations?.length ?? 0}
                      onOpen={() => void openPdfPreview(message, actualIndex)}
                      onReview={() => void sendToReview(message, actualIndex)}
                    />
                  ) : isUser ? (
                    <div className="user-text">
                      {message.content}
                      {message.isStreaming && <span className="chat-caret" aria-hidden="true" />}
                    </div>
                  ) : drugFocus && !message.isStreaming ? (
                    // Drug-Interactions report: colour-coded matrix (3+ drugs)
                    // above formatted clinical cards — never raw markdown.
                    <>
                      {(() => {
                        const matrix = interactionMatrixFromReport(message.content);
                        return matrix ? <InteractionMatrix matrix={matrix} /> : null;
                      })()}
                      <InteractionReportBody content={message.content} />
                    </>
                  ) : (
                    <div className="assistant-text">
                      <MarkdownText content={message.content} />
                      {message.isStreaming && <span className="chat-caret" aria-hidden="true" />}
                    </div>
                  )}
                  {message.outlineProposal && onDraftOutline && !message.isStreaming && (
                    <button
                      type="button"
                      className="outline-draft-btn"
                      onClick={() => onDraftOutline(message.outlineProposal!.query)}
                    >
                      <Icon name="flask" size={13} /> Draft full paper
                    </button>
                  )}
                  {message.citations && message.citations.length > 0 && !isDocument && (
                    <div className="inline-citations">
                      {(() => {
                        // The exact supporting sentence from each cited source, so a
                        // reader can verify a citation against the precise text.
                        const spans = findSupportingSpans(message.content, message.citations ?? []);
                        return message.citations.slice(0, 6).map((item, i) => {
                          const span = spans[i];
                          const tip = isRetracted(item)
                            ? 'This paper has been retracted'
                            : span
                              ? `Supports: “${span}”`
                              : undefined;
                          return (
                            <a
                              key={evidenceKey(item, i)}
                              href={isSafeUrl(item.url) ? item.url : undefined}
                              target="_blank"
                              rel="noreferrer"
                              className={isRetracted(item) ? 'citation-retracted' : ''}
                              title={tip}
                            >
                              <Icon name="quote" size={10} /> [{i + 1}] {item.source}
                              {isRetracted(item) && <span className="retraction-badge">RETRACTED</span>}
                            </a>
                          );
                        });
                      })()}
                    </div>
                  )}
                  {message.unsupportedClaims && message.unsupportedClaims.length > 0 && !isDocument && (
                    <div
                      className="claim-check-note"
                      title={`Not clearly supported by the cited source:\n\n${message.unsupportedClaims
                        .map((s) => `• ${s}`)
                        .join('\n\n')}`}
                    >
                      <Icon name="shield" size={11} />{' '}
                      {message.unsupportedClaims.length}{' '}
                      {message.unsupportedClaims.length === 1 ? 'sentence' : 'sentences'} may not be fully
                      supported by the cited source
                    </div>
                  )}
                  {!isSystem && !message.isStreaming && (
                    <div className="actions-rail">
                      <button type="button" onClick={() => void copyMessage(message)} className="action">
                        <Icon name={copiedId === message.id ? 'check' : 'copy'} size={13} />
                        {copiedId === message.id ? 'Copied' : 'Copy'}
                      </button>
                      {isUser && onEdit && (
                        <button type="button" onClick={() => onEdit(message.id)} className="action">
                          <Icon name="edit" size={13} /> Edit
                        </button>
                      )}
                      <button type="button" onClick={() => void openPdfPreview(message, actualIndex)} className="action">
                        <Icon name="filePdf" size={13} /> PDF
                      </button>
                      <button type="button" onClick={() => openMarkdownPreview(message, actualIndex)} className="action">
                        <Icon name="document" size={13} /> MD
                      </button>
                      <button type="button" onClick={() => void exportMessageDocx(exportableFor(message, actualIndex))} className="action">
                        <Icon name="document" size={13} /> Word
                      </button>
                      <button type="button" onClick={() => exportMessageLatex(exportableFor(message, actualIndex))} className="action">
                        <Icon name="document" size={13} /> LaTeX
                      </button>
                      {isAi && !message.critiqueOf && onRegenerate && (
                        <>
                          <div className="action-divider" />
                          <button type="button" onClick={() => onRegenerate(message.id)} className="action regen">
                            <Icon name="refresh" size={13} /> Regenerate
                          </button>
                        </>
                      )}
                      {isAi && !message.critiqueOf && (message.manuscript || (message.citations?.length ?? 0) > 0) && (
                        <button type="button" onClick={() => void sendToReview(message, actualIndex)} className="action">
                          <Icon name="shield" size={13} /> Review
                        </button>
                      )}
                      {isAi && !message.critiqueOf && onCritique && (
                        <button type="button" onClick={() => onCritique(message.id)} className="action critique">
                          <Icon name="shield" size={13} /> Critique
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {preview && <DocumentPreviewWindow document={preview} onClose={() => setPreview(null)} />}
    </>
  );
});
