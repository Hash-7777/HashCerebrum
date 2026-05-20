import { useEffect, useRef } from 'react';
import type { EvidenceItem } from '@platform/index';
import type { ChatMessage } from '@core/store/chatHistoryStore';
import { Icon } from '@ui/icons';

export type { ChatMessage };

function evidenceKey(item: EvidenceItem, index: number) {
  return item.provenanceHash || `${item.source}-${item.title}-${index}`;
}

export function Transcript({
  messages,
  modelLabel,
  onCritique,
}: {
  messages: ChatMessage[];
  modelLabel: string;
  isRunning: boolean;
  onCritique?: (messageId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="transcript" aria-live="polite" ref={scrollRef} onScroll={handleScroll}>
      {messages.map((message) => (
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
          {message.role === 'assistant' && !message.isStreaming && !message.critiqueOf && onCritique && (
            <footer className="chat-message-actions">
              <button type="button" onClick={() => onCritique(message.id)} className="chat-action">
                <Icon name="shield" size={12} /> Critique
              </button>
            </footer>
          )}
        </article>
      ))}
    </div>
  );
}
