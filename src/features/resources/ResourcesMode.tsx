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
  formatCitation,
  useResourcesStore,
} from '@core/store/resourcesStore';
import { CollectionRail } from './components/CollectionRail';
import { ResourceCard } from './components/ResourceCard';

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

  const copyAllCitations = async () => {
    if (filtered.length === 0) return;
    const text = filtered.map((r) => formatCitation(r)).join('\n\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
    } catch {
      /* ignore */
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
              <button type="button" disabled={filtered.length === 0} onClick={() => void copyAllCitations()}>
                <Icon name="document" size={12} /> Copy citations
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
