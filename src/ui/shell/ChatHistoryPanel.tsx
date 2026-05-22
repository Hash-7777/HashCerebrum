import { useState } from 'react';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { Icon } from '@ui/icons';

export function ChatHistoryPanel() {
  const chats = useChatHistoryStore((s) => s.chats);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const newChat = useChatHistoryStore((s) => s.newChat);
  const selectChat = useChatHistoryStore((s) => s.selectChat);
  const deleteChat = useChatHistoryStore((s) => s.deleteChat);
  const renameChat = useChatHistoryStore((s) => s.renameChat);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // Stable order — sorted by creation time so opening an old conversation
  // never reshuffles the rail.
  const ordered = [...chats]
    .filter((chat) => chat.projectId === activeProjectId)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const startRename = (id: string, title: string) => {
    setEditingId(id);
    setDraft(title);
  };
  const commitRename = () => {
    if (editingId) renameChat(editingId, draft);
    setEditingId(null);
    setDraft('');
  };
  const cancelRename = () => {
    setEditingId(null);
    setDraft('');
  };

  return (
    <div className="chat-history" aria-label="Saved chats">
      <header className="chat-history-head">
        <span>Chats</span>
        <button
          type="button"
          className="chat-history-new"
          onClick={() => newChat()}
          title="New chat"
          aria-label="New chat"
        >
          <Icon name="plus" size={13} />
        </button>
      </header>
      <div className="chat-history-list">
        {ordered.length === 0 ? (
          <p className="chat-history-empty">Past chats appear here once you send a message.</p>
        ) : (
          ordered.map((chat) => (
            <div key={chat.id} className="chat-history-item" data-active={chat.id === activeChatId}>
              {editingId === chat.id ? (
                <input
                  className="chat-history-rename"
                  value={draft}
                  autoFocus
                  maxLength={48}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename();
                    else if (event.key === 'Escape') cancelRename();
                  }}
                  onBlur={commitRename}
                  aria-label="Rename chat"
                />
              ) : (
                <button
                  type="button"
                  className="chat-history-open"
                  onClick={() => selectChat(chat.id)}
                  onDoubleClick={() => startRename(chat.id, chat.title)}
                  title={chat.title}
                >
                  {chat.title}
                </button>
              )}
              {editingId !== chat.id && (
                <div className="chat-history-actions">
                  <button
                    type="button"
                    className="chat-history-action"
                    onClick={() => startRename(chat.id, chat.title)}
                    title="Rename"
                    aria-label={`Rename chat: ${chat.title}`}
                  >
                    <Icon name="edit" size={11} />
                  </button>
                  <button
                    type="button"
                    className="chat-history-action chat-history-delete"
                    onClick={() => deleteChat(chat.id)}
                    title="Delete"
                    aria-label={`Delete chat: ${chat.title}`}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
