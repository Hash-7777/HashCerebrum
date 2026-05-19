import type { EvidenceItem } from '@platform/index';
import { Icon } from '@ui/icons';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations?: EvidenceItem[];
  modelLabel?: string;
  failoverNote?: string;
  error?: string;
}

function evidenceKey(item: EvidenceItem, index: number) {
  return item.provenanceHash || `${item.source}-${item.title}-${index}`;
}

export function Transcript({
  messages,
  modelLabel,
  isRunning,
}: {
  messages: ChatMessage[];
  modelLabel: string;
  isRunning: boolean;
}) {
  return (
    <div className="transcript" aria-live="polite">
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
          <p>{message.content}</p>
          {message.citations && message.citations.length > 0 && (
            <div className="inline-citations">
              {message.citations.slice(0, 6).map((item, index) => (
                <a key={evidenceKey(item, index)} href={item.url ?? undefined} target="_blank" rel="noreferrer">
                  <Icon name="quote" size={10} /> [S{index + 1}] {item.source}
                </a>
              ))}
            </div>
          )}
        </article>
      ))}
      {isRunning && (
        <article className="chat-message chat-pending" data-role="assistant" aria-live="polite">
          <header>
            <span className="chat-role">
              <Icon name="spinner" size={12} /> {modelLabel}
            </span>
          </header>
          <p className="chat-pending-text">Querying medical sources and drafting synthesis…</p>
        </article>
      )}
    </div>
  );
}
