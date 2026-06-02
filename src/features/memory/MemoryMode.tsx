// Memory mode — third active mode. Browses and searches the active
// project's RAG knowledge store: the evidence and answers saved from
// earlier research runs. Saving happens in BrainMode after a research run;
// this view reads, searches, and prunes the same store.

import { useEffect, useMemo, useState } from 'react';
import { lexicalSearch, useRagStore, type RagChunk } from '@core/rag';
import { useProjectStore } from '@core/store/projectStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';
import { MemoryCard } from './components/MemoryCard';
import { MemoryVectorGraph3D } from './graph/MemoryVectorGraph3D';
import { keepMemoryChunk } from './pruneMemory';

const SEARCH_RESULT_LIMIT = 200;

type MemoryView = 'list' | 'graph';

export function MemoryMode() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const chunks = useRagStore((s) => s.chunks);
  const removeChunk = useRagStore((s) => s.removeChunk);
  const clearProject = useRagStore((s) => s.clearProject);
  const pruneProject = useRagStore((s) => s.pruneProject);

  const [search, setSearch] = useState('');
  // Graph is the default view — the topic map is the primary way to read memory.
  const [view, setView] = useState<MemoryView>('graph');
  // Scope: this project only, or the whole cross-project library (the deduped
  // "focused PubMed" of every trusted finding saved across projects).
  const [scope, setScope] = useState<'project' | 'library'>('project');

  const projectName = projects.find((p) => p.id === activeProjectId)?.name ?? 'Project';

  const scopedChunks = useMemo(
    () => (scope === 'library' ? chunks : chunks.filter((chunk) => chunk.projectId === activeProjectId)),
    [chunks, activeProjectId, scope],
  );
  // Prune / clear / delete always act on the ACTIVE project, so their state
  // tracks the active project's count regardless of the browse scope.
  const activeProjectCount = useMemo(
    () => chunks.filter((chunk) => chunk.projectId === activeProjectId).length,
    [chunks, activeProjectId],
  );

  // A query paints lexical results instantly, then refines to the semantic
  // (meaning-based) hybrid ranking once the embedder is ready — scoped to the
  // project being viewed. Empty search lists everything newest-first.
  const [searchResults, setSearchResults] = useState<RagChunk[]>([]);
  useEffect(() => {
    const query = search.trim();
    if (!query || !activeProjectId) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    // Instant lexical first paint.
    setSearchResults(lexicalSearch(scopedChunks, query, SEARCH_RESULT_LIMIT).map((hit) => hit.chunk));
    // Semantic refine. searchHybrid is cross-project; in library scope we keep
    // every hit, otherwise we keep only the active project's.
    void useRagStore
      .getState()
      .searchHybrid(activeProjectId, query, SEARCH_RESULT_LIMIT)
      .then((hits) => {
        if (cancelled) return;
        const scoped = (scope === 'library' ? hits : hits.filter((hit) => hit.chunk.projectId === activeProjectId)).map(
          (hit) => hit.chunk,
        );
        if (scoped.length > 0) setSearchResults(scoped);
      });
    return () => {
      cancelled = true;
    };
  }, [scopedChunks, search, activeProjectId, scope]);

  const visible = useMemo(() => {
    if (!search.trim()) {
      return [...scopedChunks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return searchResults;
  }, [scopedChunks, search, searchResults]);

  return (
    <div className="mode memory-mode">
      <section className="memory-main" aria-label="Project memory">
        <header className="memory-toolbar">
          <div>
            <p className="eyebrow">
              <Icon name="database" size={10} /> Memory
            </p>
            <h1>{scope === 'library' ? 'Library' : projectName}</h1>
            <p className="memory-subtitle">
              {visible.length} {visible.length === 1 ? 'saved finding' : 'saved findings'}
              {scope === 'library' ? ' across all projects' : ''}
              {search.trim() ? ` matching "${search.trim()}"` : ''}
            </p>
          </div>
          <div className="memory-tools">
            <label className="memory-search">
              <Icon name="search" size={13} />
              <input
                placeholder="Search this project's memory…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className="memory-view-toggle" role="group" aria-label="Memory scope">
              <button
                type="button"
                data-active={scope === 'project'}
                onClick={() => setScope('project')}
                aria-pressed={scope === 'project'}
                title="Browse only this project's memory"
              >
                <Icon name="database" size={13} /> Project
              </button>
              <button
                type="button"
                data-active={scope === 'library'}
                onClick={() => setScope('library')}
                aria-pressed={scope === 'library'}
                title="Browse the whole cross-project library (every trusted finding, de-duplicated)"
              >
                <Icon name="graph" size={13} /> Library
              </button>
            </div>
            <div className="memory-view-toggle" role="group" aria-label="Memory view">
              <button
                type="button"
                data-active={view === 'list'}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                <Icon name="list" size={13} /> List
              </button>
              <button
                type="button"
                data-active={view === 'graph'}
                onClick={() => setView('graph')}
                aria-pressed={view === 'graph'}
              >
                <Icon name="graph" size={13} /> Graph
              </button>
            </div>
            <button
              type="button"
              className="memory-prune"
              disabled={activeProjectCount === 0}
              title="Remove non-medical and off-topic findings, keeping the rest"
              onClick={() => {
                if (!activeProjectId || activeProjectCount === 0) return;
                const removed = pruneProject(activeProjectId, keepMemoryChunk);
                useToastStore
                  .getState()
                  .show(
                    removed > 0
                      ? `Pruned ${removed} non-medical / off-topic ${removed === 1 ? 'finding' : 'findings'}`
                      : 'Nothing to prune — memory is already clean',
                    'info',
                  );
              }}
            >
              <Icon name="refresh" size={13} /> Prune
            </button>
            <button
              type="button"
              className="memory-clear"
              disabled={activeProjectCount === 0}
              title="Delete all saved memory in this project"
              onClick={() => {
                if (!activeProjectId || activeProjectCount === 0) return;
                const ok = window.confirm(
                  `Delete all ${activeProjectCount} saved ${
                    activeProjectCount === 1 ? 'finding' : 'findings'
                  } in "${projectName}"? This permanently empties this project's memory and cannot be undone.`,
                );
                if (ok) clearProject(activeProjectId);
              }}
            >
              <Icon name="close" size={13} /> Delete all
            </button>
          </div>
        </header>

        {visible.length === 0 ? (
          <div className="memory-empty">
            <Icon name="database" size={22} />
            <p>
              {scopedChunks.length === 0
                ? scope === 'library'
                  ? 'No research saved in any project yet.'
                  : 'This project has no saved research yet.'
                : 'No saved memory matches your search.'}
            </p>
            <p className="memory-empty-hint">
              Ask a research question in <strong>Brain</strong> mode — the evidence it
              retrieves and the answer it writes are saved into this project&apos;s memory
              automatically.
            </p>
          </div>
        ) : view === 'graph' ? (
          <MemoryVectorGraph3D chunks={visible} onRemove={removeChunk} />
        ) : (
          <div className="memory-list">
            {visible.map((chunk) => (
              <MemoryCard key={chunk.id} chunk={chunk} onRemove={removeChunk} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
