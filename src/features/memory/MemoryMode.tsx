// Memory mode — third active mode. Browses and searches the active
// project's RAG knowledge store: the evidence and answers saved from
// earlier research runs. Saving happens in BrainMode after a research run;
// this view reads, searches, and prunes the same store.

import { useMemo, useState } from 'react';
import { lexicalSearch, useRagStore } from '@core/store/ragStore';
import { useProjectStore } from '@core/store/projectStore';
import { Icon } from '@ui/icons';
import { MemoryCard } from './components/MemoryCard';
import { MemoryGraphView } from './graph/MemoryGraphView';

const SEARCH_RESULT_LIMIT = 200;

type MemoryView = 'list' | 'graph';

export function MemoryMode() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const chunks = useRagStore((s) => s.chunks);
  const removeChunk = useRagStore((s) => s.removeChunk);
  const clearProject = useRagStore((s) => s.clearProject);

  const [search, setSearch] = useState('');
  // Graph is the default view — the topic map is the primary way to read memory.
  const [view, setView] = useState<MemoryView>('graph');

  const projectName = projects.find((p) => p.id === activeProjectId)?.name ?? 'Project';

  const projectChunks = useMemo(
    () => chunks.filter((chunk) => chunk.projectId === activeProjectId),
    [chunks, activeProjectId],
  );

  // Empty search lists everything newest-first; a query ranks by the same
  // lexical scorer the research agent's rag_search tool uses.
  const visible = useMemo(() => {
    if (!search.trim()) {
      return [...projectChunks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return lexicalSearch(projectChunks, search, SEARCH_RESULT_LIMIT).map((hit) => hit.chunk);
  }, [projectChunks, search]);

  return (
    <div className="mode memory-mode">
      <section className="memory-main" aria-label="Project memory">
        <header className="memory-toolbar">
          <div>
            <p className="eyebrow">
              <Icon name="database" size={10} /> Memory
            </p>
            <h1>{projectName}</h1>
            <p className="memory-subtitle">
              {visible.length} {visible.length === 1 ? 'saved finding' : 'saved findings'}
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
              className="memory-clear"
              disabled={projectChunks.length === 0}
              title="Delete all saved memory in this project"
              onClick={() => {
                if (!activeProjectId || projectChunks.length === 0) return;
                const ok = window.confirm(
                  `Delete all ${projectChunks.length} saved ${
                    projectChunks.length === 1 ? 'finding' : 'findings'
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
              {projectChunks.length === 0
                ? 'This project has no saved research yet.'
                : 'No saved memory matches your search.'}
            </p>
            <p className="memory-empty-hint">
              Ask a research question in <strong>Brain</strong> mode — the evidence it
              retrieves and the answer it writes are saved into this project&apos;s memory
              automatically.
            </p>
          </div>
        ) : view === 'graph' ? (
          <MemoryGraphView chunks={visible} onRemove={removeChunk} />
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
