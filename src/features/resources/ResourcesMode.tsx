// Resources mode — second active mode. Browses saved evidence,
// collections, tags, notes; exports Markdown / BibTeX / CSL-JSON.
//
// Saving happens from BrainMode (via useResourcesStore().add(evidence)
// triggered from the evidence card). This view reads the same store.

import { useMemo, useState } from 'react';
import { Icon } from '@ui/icons';
import {
  exportBibtex,
  exportCslJson,
  exportMarkdown,
  useResourcesStore,
  type Collection,
  type SavedResource,
} from '@core/store/resourcesStore';

type ExportFormat = 'markdown' | 'bibtex' | 'csl-json';

function download(filename: string, body: string, mime: string) {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function CollectionRail({
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
        {collections.map((c) => (
          <li key={c.id} data-active={c.id === activeId}>
            {editingId === c.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onRename(c.id, editingName);
                  setEditingId(null);
                }}
              >
                <input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onBlur={() => setEditingId(null)}
                  autoFocus
                />
              </form>
            ) : (
              <button type="button" onClick={() => onSelect(c.id)} onDoubleClick={() => {
                if (c.id === 'inbox') return;
                setEditingId(c.id);
                setEditingName(c.name);
              }}>
                <span className="resources-rail-name">{c.name}</span>
                <span className="resources-rail-count">{countFor(c.id)}</span>
              </button>
            )}
            {c.id !== 'inbox' && (
              <button
                type="button"
                className="resources-rail-delete"
                aria-label={`Delete ${c.name}`}
                onClick={() => onDelete(c.id)}
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="resources-rail-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onCreate(draft.trim());
          setDraft('');
        }}
      >
        <input
          placeholder="New collection"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" aria-label="Create collection" disabled={!draft.trim()}>
          <Icon name="check" size={13} />
        </button>
      </form>
    </aside>
  );
}

function ResourceCard({
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
  const e = resource.evidence;

  return (
    <article className="resource-card">
      <header>
        <div>
          <span className="resource-source">
            <Icon name="quote" size={11} /> {e.source}
          </span>
          {e.year && <time>{e.year}</time>}
        </div>
        <button type="button" className="resource-remove" onClick={() => onRemove(resource.id)} aria-label="Remove">
          <Icon name="close" size={13} />
        </button>
      </header>
      <h4>{e.title}</h4>
      {e.snippet && <p className="resource-snippet">{e.snippet}</p>}
      {e.url && (
        <a href={e.url} target="_blank" rel="noreferrer" className="resource-link">
          <Icon name="eye" size={11} /> Open source
        </a>
      )}
      <div className="resource-row">
        <label>
          <span>Collection</span>
          <select value={resource.collectionId} onChange={(event) => onMove(resource.id, event.target.value)}>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="resource-tags">
        {resource.tags.map((t) => (
          <button key={t} type="button" className="resource-tag" onClick={() => onTag(resource.id, t)}>
            {t} ×
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
          <input
            placeholder="add tag"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
          />
        </form>
      </div>
      <textarea
        className="resource-notes"
        placeholder="Notes…"
        value={resource.notes}
        onChange={(event) => onNotes(resource.id, event.target.value)}
        rows={2}
      />
    </article>
  );
}

export function ResourcesMode() {
  const resources = useResourcesStore((s) => s.resources);
  const collections = useResourcesStore((s) => s.collections);
  const add = useResourcesStore((s) => s.add); // kept reachable for inbound saves
  const remove = useResourcesStore((s) => s.remove);
  const updateNotes = useResourcesStore((s) => s.updateNotes);
  const toggleTag = useResourcesStore((s) => s.toggleTag);
  const moveTo = useResourcesStore((s) => s.moveTo);
  const createCollection = useResourcesStore((s) => s.createCollection);
  const renameCollection = useResourcesStore((s) => s.renameCollection);
  const deleteCollection = useResourcesStore((s) => s.deleteCollection);
  void add; // re-export side-effect: keep `add` in the binding graph

  const [activeId, setActiveId] = useState<string>(collections[0]?.id ?? 'inbox');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const scope = resources.filter((r) => r.collectionId === activeId);
    if (!search.trim()) return scope;
    const q = search.toLowerCase();
    return scope.filter(
      (r) =>
        r.evidence.title.toLowerCase().includes(q) ||
        r.evidence.snippet?.toLowerCase().includes(q) ||
        r.tags.some((t) => t.includes(q)) ||
        r.notes.toLowerCase().includes(q),
    );
  }, [resources, activeId, search]);

  const countFor = (id: string) => resources.filter((r) => r.collectionId === id).length;
  const activeCollection = collections.find((c) => c.id === activeId) ?? collections[0]!;

  const doExport = (format: ExportFormat) => {
    if (filtered.length === 0) return;
    if (format === 'markdown') {
      download(`${activeCollection.name}.md`, exportMarkdown(filtered, activeCollection.name), 'text/markdown');
    } else if (format === 'bibtex') {
      download(`${activeCollection.name}.bib`, exportBibtex(filtered), 'application/x-bibtex');
    } else {
      download(`${activeCollection.name}.csl.json`, exportCslJson(filtered), 'application/json');
    }
  };

  return (
    <div className="mode resources-mode">
      <CollectionRail
        collections={collections}
        activeId={activeCollection.id}
        countFor={countFor}
        onSelect={setActiveId}
        onCreate={(name) => {
          const c = createCollection(name);
          setActiveId(c.id);
        }}
        onRename={renameCollection}
        onDelete={(id) => {
          deleteCollection(id);
          if (activeId === id) setActiveId('inbox');
        }}
      />
      <section className="resources-main" aria-label="Saved resources">
        <header className="resources-toolbar">
          <div>
            <p className="eyebrow">
              <Icon name="book" size={10} /> Resources
            </p>
            <h1>{activeCollection.name}</h1>
            <p className="resources-subtitle">
              {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
              {search ? ` matching "${search}"` : ''}
            </p>
          </div>
          <div className="resources-actions">
            <label className="resources-search">
              <Icon name="search" size={13} />
              <input
                placeholder="Filter by title, tag, note…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="resources-export">
              <button type="button" disabled={filtered.length === 0} onClick={() => doExport('markdown')}>
                <Icon name="document" size={12} /> Markdown
              </button>
              <button type="button" disabled={filtered.length === 0} onClick={() => doExport('bibtex')}>
                <Icon name="book" size={12} /> BibTeX
              </button>
              <button type="button" disabled={filtered.length === 0} onClick={() => doExport('csl-json')}>
                <Icon name="quote" size={12} /> CSL-JSON
              </button>
            </div>
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="resources-empty">
            <Icon name="book" size={22} />
            <p>No saved records here yet.</p>
            <p className="resources-empty-hint">
              Run a brain research query, then tap the bookmark icon on any evidence card to save it to{' '}
              <strong>{activeCollection.name}</strong>.
            </p>
          </div>
        ) : (
          <div className="resources-list">
            {filtered.map((r) => (
              <ResourceCard
                key={r.id}
                resource={r}
                collections={collections}
                onRemove={remove}
                onMove={moveTo}
                onTag={toggleTag}
                onNotes={updateNotes}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
