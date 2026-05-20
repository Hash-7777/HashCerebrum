import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { Icon } from '@ui/icons';

export function ChatHistoryPanel() {
  const chats = useChatHistoryStore((s) => s.chats);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const newChat = useChatHistoryStore((s) => s.newChat);
  const selectChat = useChatHistoryStore((s) => s.selectChat);
  const deleteChat = useChatHistoryStore((s) => s.deleteChat);

  const ordered = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <div className="chat-history" aria-label="Saved chats">
      <header className="chat-history-head">
        <span>Chats</span>
        <button type="button" className="chat-history-new" onClick={() => newChat()} title="New chat" aria-label="New chat">
          <Icon name="plus" size={13} />
        </button>
      </header>
      <div className="chat-history-list">
        {ordered.length === 0 ? (
          <p className="chat-history-empty">Past chats appear here once you send a message.</p>
        ) : (
          ordered.map((chat) => (
            <div key={chat.id} className="chat-history-item" data-active={chat.id === activeChatId}>
              <button
                type="button"
                className="chat-history-open"
                onClick={() => selectChat(chat.id)}
                title={chat.title}
              >
                {chat.title}
              </button>
              <button
                type="button"
                className="chat-history-delete"
                onClick={() => deleteChat(chat.id)}
                aria-label={`Delete chat: ${chat.title}`}
              >
                <Icon name="close" size={11} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
