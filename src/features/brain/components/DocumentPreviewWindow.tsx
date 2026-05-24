import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '@ui/icons';
import { downloadBlob } from '../export/messageExport';

const STORAGE_KEY = 'hc.documentPreview.rect.v1';
const MIN_W = 380;
const MIN_H = 300;

export interface PreviewDocument {
  title: string;
  filename: string;
  kind: 'pdf' | 'markdown' | 'text';
  typeLabel: string;
  blob: Blob;
  copyText: string;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function defaultRect(): Rect {
  const width = Math.min(860, Math.max(MIN_W, Math.round(window.innerWidth * 0.56)));
  const height = Math.min(640, Math.max(MIN_H, Math.round(window.innerHeight * 0.68)));
  return {
    width,
    height,
    left: Math.round((window.innerWidth - width) / 2),
    top: Math.round((window.innerHeight - height) / 2),
  };
}

function clampRect(rect: Rect): Rect {
  const width = Math.min(Math.max(rect.width, MIN_W), window.innerWidth - 16);
  const height = Math.min(Math.max(rect.height, MIN_H), window.innerHeight - 16);
  return {
    width,
    height,
    left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
    top: Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - height - 8)),
  };
}

function loadRect(): Rect {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Rect> | null;
    if (
      parsed &&
      Number.isFinite(parsed.left) &&
      Number.isFinite(parsed.top) &&
      Number.isFinite(parsed.width) &&
      Number.isFinite(parsed.height)
    ) {
      return clampRect(parsed as Rect);
    }
  } catch {
    /* use default */
  }
  return defaultRect();
}

function saveRect(rect: Rect): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clampRect(rect)));
  } catch {
    /* ignore */
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

export function DocumentPreviewWindow({
  document,
  onClose,
}: {
  document: PreviewDocument;
  onClose: () => void;
}) {
  const [rect, setRect] = useState(loadRect);
  const [copied, setCopied] = useState(false);
  const url = useMemo(
    () => (document.kind === 'pdf' ? URL.createObjectURL(document.blob) : ''),
    [document.blob, document.kind],
  );
  const emptyBlob = document.blob.size < 64;

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  useEffect(() => {
    const onResize = () => setRect((current) => clampRect(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const updateRect = (next: Rect) => {
    const clamped = clampRect(next);
    setRect(clamped);
    saveRect(clamped);
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, rect };

    const move = (moveEvent: PointerEvent) => {
      updateRect({
        ...start.rect,
        left: start.rect.left + moveEvent.clientX - start.x,
        top: start.rect.top + moveEvent.clientY - start.y,
      });
    };
    const up = () => {
      target.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>, dir: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, rect };

    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      let { left, top, width, height } = start.rect;
      if (dir.includes('e')) width += dx;
      if (dir.includes('s')) height += dy;
      if (dir.includes('w')) {
        width -= dx;
        left += dx;
      }
      if (dir.includes('n')) {
        height -= dy;
        top += dy;
      }
      updateRect({ left, top, width, height });
    };
    const up = () => {
      target.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const copyDocument = async () => {
    await navigator.clipboard?.writeText(document.copyText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className="document-preview-layer"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="document-preview-window"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }}
        onPointerDown={(event) => event.stopPropagation()}
        aria-label={`${document.typeLabel} preview`}
      >
        {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((dir) => (
          <span
            key={dir}
            className={`document-preview-resize ${dir}`}
            onPointerDown={(event) => startResize(event, dir)}
            aria-hidden="true"
          />
        ))}
        <header className="document-preview-titlebar" onPointerDown={startDrag}>
          <div className="document-preview-title">
            <strong>{document.filename}</strong>
            <span>{document.typeLabel} · {formatBytes(document.blob.size)}</span>
          </div>
          <div className="document-preview-actions">
            <button type="button" onClick={() => void copyDocument()} title="Copy text">
              <Icon name={copied ? 'check' : 'copy'} size={13} />
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" onClick={() => downloadBlob(document.filename, document.blob)} title="Download">
              <Icon name="download" size={13} />
              Download
            </button>
            <button type="button" onClick={onClose} title="Close" aria-label="Close preview">
              <Icon name="close" size={13} />
            </button>
          </div>
        </header>
        <div className="document-preview-body">
          {emptyBlob ? (
            <div className="document-preview-empty">
              <Icon name="alert" size={18} />
              <strong>Preview unavailable</strong>
              <p>The exported file has no readable bytes. Regenerate the document, then export again.</p>
            </div>
          ) : document.kind === 'pdf' ? (
            <iframe className="document-preview-pdf" title={document.title} src={url} sandbox="" />
          ) : (
            <pre>{document.copyText}</pre>
          )}
        </div>
      </section>
    </div>
  );
}
