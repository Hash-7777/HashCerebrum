import { useState } from 'react';
import type { Collection } from '@core/store/resourcesStore';
import { Icon } from '@ui/icons';

export function CollectionRail({
  collections,
  activeId,
  countFor,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  collections: Collection[];
  activeId: string;
  countFor: (id: string) => number;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  return (
    <aside className="resources-rail" aria-label="Collections">
      <header>
        <h3>
          <Icon name="database" size={12} /> Collections
        </h3>
      </header>
      <ul>
        {collections.map((collection) => (
          <li key={collection.id} data-active={collection.id === activeId}>
            {editingId === collection.id ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onRename(collection.id, editingName);
                  setEditingId(null);
                }}
              >
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  onBlur={() => setEditingId(null)}
                  autoFocus
                />
              </form>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(collection.id)}
                onDoubleClick={() => {
                  if (collection.id === 'inbox') return;
                  setEditingId(collection.id);
                  setEditingName(collection.name);
                }}
              >
                <span className="resources-rail-name">{collection.name}</span>
                <span className="resources-rail-count">{countFor(collection.id)}</span>
              </button>
            )}
            {collection.id !== 'inbox' && (
              <button
                type="button"
                className="resources-rail-delete"
                aria-label={`Delete ${collection.name}`}
                onClick={() => onDelete(collection.id)}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="resources-rail-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          onCreate(draft.trim());
          setDraft('');
        }}
      >
        <input placeholder="New collection" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" aria-label="Create collection" disabled={!draft.trim()}>
          <Icon name="check" size={13} />
        </button>
      </form>
    </aside>
  );
}
