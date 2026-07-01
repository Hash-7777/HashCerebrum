import { useState } from 'react';
import { useChatHistoryStore } from '@core/store/chatHistoryStore';
import { useProjectStore } from '@core/store/projectStore';
import { useModeStore } from '@core/store/modeStore';
import { Icon } from '@ui/icons';

function groupLabel(createdAt: string | undefined): 'today' | 'week' | 'earlier' {
  if (!createdAt) return 'earlier';
  const d = new Date(createdAt);
  const now = new Date();
  const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 1) return 'today';
  if (diffDays < 7) return 'week';
  return 'earlier';
}

const GROUP_LABELS: Record<string, string> = { today: 'Today', week: 'This week', earlier: 'Earlier' };
const GROUP_ORDER = ['today', 'week', 'earlier'] as const;

export function ChatHistoryPanel() {
  const chats = useChatHistoryStore((s) => s.chats);
  const activeChatId = useChatHistoryStore((s) => s.activeChatId);
  const newChat = useChatHistoryStore((s) => s.newChat);
  const selectChat = useChatHistoryStore((s) => s.selectChat);
  const deleteChat = useChatHistoryStore((s) => s.deleteChat);
  const renameChat = useChatHistoryStore((s) => s.renameChat);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const setMode = useModeStore((s) => s.setMode);
  // Drug-interaction and genetics chats are now Brain chats (those modes were
  // merged into the mega-mind), so the Brain history is the single list — older
  // chats saved under the retired modes fold into it.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');

  const ordered = [...chats]
    .filter((c) => c.projectId === activeProjectId)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  const filtered = filter
    ? ordered.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()))
    : ordered;

  const grouped = GROUP_ORDER.map((g) => ({
    id: g,
    label: GROUP_LABELS[g]!,
    items: filtered.filter((c) => groupLabel(c.createdAt) === g),
  })).filter((g) => g.items.length > 0);

  const startRename = (id: string, title: string) => { setEditingId(id); setDraft(title); };
  const commitRename = () => { if (editingId) renameChat(editingId, draft); setEditingId(null); setDraft(''); };
  const cancelRename = () => { setEditingId(null); setDraft(''); };

  return (
    <div className="side-section chats-section" aria-label="Saved chats">
      <div className="search-wrap">
        <Icon name="search" size={13} />
        <input
          type="text"
          className="search-input"
          placeholder="Search chats…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn compact"
          onClick={() => newChat('brain')}
          title="New chat"
          aria-label="New chat"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>

      <div className="chats">
        {filtered.length === 0 ? (
          <p className="chat-history-empty">
            {filter ? 'No matching chats.' : 'Past chats appear here once you send a message.'}
          </p>
        ) : (
          grouped.map((group) => (
            <div key={group.id} className="chat-group">
              <div className="chat-group-label">{group.label}</div>
              {group.items.map((chat) => (
                <div
                  key={chat.id}
                  className={`chat-item${chat.id === activeChatId ? ' active' : ''}`}
                  onClick={() => {
                    if (editingId !== chat.id) {
                      selectChat(chat.id);
                      setMode('brain');
                    }
                  }}
                >
                  <div className="chat-line" />
                  <div className="chat-body">
                    {editingId === chat.id ? (
                      <input
                        className="chat-history-rename"
                        value={draft}
                        autoFocus
                        maxLength={48}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          else if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Rename chat"
                      />
                    ) : (
                      <div className="chat-title-row">
                        <span className="title">{chat.title}</span>
                      </div>
                    )}
                    {editingId !== chat.id && (
                      <div className="chat-meta-row">
                        <span className="ts">
                          {chat.createdAt
                            ? new Date(chat.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            : ''}
                        </span>
                      </div>
                    )}
                  </div>
                  {editingId !== chat.id && (
                    <div className="chat-hover-actions">
                      <button
                        type="button"
                        className="icon-btn compact"
                        onClick={(e) => { e.stopPropagation(); startRename(chat.id, chat.title); }}
                        title="Rename"
                        aria-label={`Rename chat: ${chat.title}`}
                      >
                        <Icon name="edit" size={11} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn compact danger"
                        onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                        title="Delete"
                        aria-label={`Delete chat: ${chat.title}`}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
