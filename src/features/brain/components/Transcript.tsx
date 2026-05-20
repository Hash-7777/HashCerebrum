import { useEffect, useRef, useState } from 'react';
import type { EvidenceItem } from '@platform/index';
import type { ChatMessage } from '@core/store/chatHistoryStore';
import { Icon } from '@ui/icons';
import { exportMessageMarkdown, exportMessagePdf, type ExportableMessage } from '../export/messageExport';

export type { ChatMessage };

function evidenceKey(item: EvidenceItem, index: number) {
  return item.provenanceHash || `${item.source}-${item.title}-${index}`;
}

export function Transcript({
  messages,
  modelLabel,
  onCritique,
  onRegenerate,
  onEdit,
}: {
  messages: ChatMessage[];
  modelLabel: string;
  isRunning: boolean;
  onCritique?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEdit?: (messageId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Whether the view is "pinned" to the bottom. We only auto-follow new
  // content while pinned, so scrolling up to read scrollback is never
  // interrupted by an incoming answer.
  const pinnedRef = useRef(true);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const copyMessage = async (message: ChatMessage) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(message.content);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = message.content;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId((current) => (current === message.id ? null : current)), 1200);
    } catch {
      setCopiedId(null);
    }
  };

  const titleFor = (message: ChatMessage, index: number) => {
    const firstLine = message.content.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').trim();
    return firstLine ? firstLine.slice(0, 96) : `HashCerebrum message ${index + 1}`;
  };

  const exportableFor = (message: ChatMessage, index: number): ExportableMessage => ({
    title: titleFor(message, index),
    role: message.role,
    content: message.content,
    modelLabel: message.modelLabel ?? modelLabel,
    ...(message.citations ? { citations: message.citations } : {}),
  });

  return (
    <div className="transcript" aria-live="polite" ref={scrollRef} onScroll={handleScroll}>
      {messages.map((message, index) => (
        <article key={message.id} className="chat-message" data-role={message.role} data-error={!!message.error}>
          <header>
            <span className="chat-role">
              {message.role === 'user' ? (
                <>
                  <Icon name="agent" size={12} /> You
                </>
              ) : message.role === 'system' ? (
                <>
                  <Icon name="brain" size={12} /> Workspace
                </>
              ) : (
                <>
                  <Icon name="brain" size={12} /> {message.modelLabel ?? modelLabel}
                </>
              )}
            </span>
            {message.failoverNote && <span className="chat-failover">{message.failoverNote}</span>}
          </header>
          <p>
            {message.content}
            {message.isStreaming && <span className="chat-caret" aria-hidden="true" />}
          </p>
          {message.citations && message.citations.length > 0 && (
            <div className="inline-citations">
              {message.citations.slice(0, 6).map((item, index) => (
                <a key={evidenceKey(item, index)} href={item.url ?? undefined} target="_blank" rel="noreferrer">
                  <Icon name="quote" size={10} /> [S{index + 1}] {item.source}
                </a>
              ))}
            </div>
          )}
          {message.role !== 'system' && !message.isStreaming && (
            <footer className="chat-message-actions">
              <button type="button" onClick={() => void copyMessage(message)} className="chat-action">
                <Icon name={copiedId === message.id ? 'check' : 'copy'} size={12} />
                {copiedId === message.id ? 'Copied' : 'Copy'}
              </button>
              {message.role === 'user' && onEdit && (
                <button type="button" onClick={() => onEdit(message.id)} className="chat-action">
                  <Icon name="edit" size={12} /> Edit
                </button>
              )}
              {message.role === 'assistant' && !message.critiqueOf && onRegenerate && (
                <button type="button" onClick={() => onRegenerate(message.id)} className="chat-action">
                  <Icon name="refresh" size={12} /> Regenerate
                </button>
              )}
              <button
                type="button"
                onClick={() => exportMessagePdf(exportableFor(message, index))}
                className="chat-action"
              >
                <Icon name="download" size={12} /> PDF
              </button>
              <button
                type="button"
                onClick={() => exportMessageMarkdown(exportableFor(message, index))}
                className="chat-action"
              >
                <Icon name="document" size={12} /> MD
              </button>
              {message.role === 'assistant' && !message.critiqueOf && onCritique && (
                <button type="button" onClick={() => onCritique(message.id)} className="chat-action">
                  <Icon name="shield" size={12} /> Critique
                </button>
              )}
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}
