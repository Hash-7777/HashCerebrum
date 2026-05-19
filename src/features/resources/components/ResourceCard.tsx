import { useState } from 'react';
import type { Collection, SavedResource } from '@core/store/resourcesStore';
import { Icon } from '@ui/icons';

export function ResourceCard({
  resource,
  collections,
  onRemove,
  onMove,
  onTag,
  onNotes,
}: {
  resource: SavedResource;
  collections: Collection[];
  onRemove: (id: string) => void;
  onMove: (id: string, collectionId: string) => void;
  onTag: (id: string, tag: string) => void;
  onNotes: (id: string, value: string) => void;
}) {
  const [tagDraft, setTagDraft] = useState('');
  const evidence = resource.evidence;

  return (
    <article className="resource-card">
      <header>
        <div>
          <span className="resource-source">
            <Icon name="quote" size={11} /> {evidence.source}
          </span>
          {evidence.year && <time>{evidence.year}</time>}
        </div>
        <button type="button" className="resource-remove" onClick={() => onRemove(resource.id)} aria-label="Remove">
          <Icon name="close" size={13} />
        </button>
      </header>
      <h4>{evidence.title}</h4>
      {evidence.snippet && <p className="resource-snippet">{evidence.snippet}</p>}
      {evidence.url && (
        <a href={evidence.url} target="_blank" rel="noreferrer" className="resource-link">
          <Icon name="eye" size={11} /> Open source
        </a>
      )}
      <div className="resource-row">
        <label>
          <span>Collection</span>
          <select value={resource.collectionId} onChange={(event) => onMove(resource.id, event.target.value)}>
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="resource-tags">
        {resource.tags.map((tag) => (
          <button key={tag} type="button" className="resource-tag" onClick={() => onTag(resource.id, tag)}>
            {tag} x
          </button>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!tagDraft.trim()) return;
            onTag(resource.id, tagDraft);
            setTagDraft('');
          }}
        >
          <input placeholder="add tag" value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} />
        </form>
      </div>
      <textarea
        className="resource-notes"
        placeholder="Notes..."
        value={resource.notes}
        onChange={(event) => onNotes(resource.id, event.target.value)}
        rows={2}
      />
    </article>
  );
}
