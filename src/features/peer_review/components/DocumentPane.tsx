// The read-only document pane beside a review. It prefers the real PDF,
// rasterised with pdf.js (loaded on first use, and rebuilt from the bytes kept
// in IndexedDB after a restart); without one it shows a manuscript's saved HTML
// in a sandboxed frame, and otherwise the extracted text.

import { useRef, useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import type { ReviewedPaper } from '@core/store/peerReviewStore';
import { loadPdf } from '@core/store/pdfBlobStore';
import { currentDocumentText, textToPreviewHtml } from './editorHtml';

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

export function DocumentPane({ paper }: { paper: ReviewedPaper }) {
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
