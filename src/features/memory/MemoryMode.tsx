// Memory mode — third active mode. Browses and searches the active
// project's RAG knowledge store: the evidence and answers saved from
// earlier research runs. Saving happens in BrainMode after a research run;
// this view reads, searches, and prunes the same store.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getChunkVectors, lexicalSearch, useRagStore, type RagChunk } from '@core/rag';
import { getEmbeddingProvider } from '@core/rag/embeddings/workerClient';
import { useLearningStore } from '@core/rag/agentic/learningStore';
import { useProjectStore } from '@core/store/projectStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';
import { MemoryCard } from './components/MemoryCard';
import { PrunePreview } from './components/PrunePreview';
import { MemoryVectorGraph3D } from './graph/MemoryVectorGraph3D';
import { planPrune } from './pruneMemory';
import { importPdfFiles, summarizeImport } from './import/importPdfs';

const SEARCH_RESULT_LIMIT = 200;

type MemoryView = 'list' | 'graph';

export function MemoryMode() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const projects = useProjectStore((s) => s.projects);
  const chunks = useRagStore((s) => s.chunks);
  const removeChunk = useRagStore((s) => s.removeChunk);
  const clearProject = useRagStore((s) => s.clearProject);
  const pruneChunks = useRagStore((s) => s.pruneChunks);
  const undoLastPrune = useRagStore((s) => s.undoLastPrune);
  const libraryDocuments = useRagStore((s) => s.libraryDocuments);
  const removeDocument = useRagStore((s) => s.removeDocument);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showDocs, setShowDocs] = useState(false);

  const [search, setSearch] = useState('');
  // Graph is the default view — the topic map is the primary way to read memory.
  const [view, setView] = useState<MemoryView>('graph');
  // Scope: this project only, or the whole cross-project library (the deduped
  // "focused PubMed" of every trusted finding saved across projects).
  const [scope, setScope] = useState<'project' | 'library'>('project');

  const projectName = projects.find((p) => p.id === activeProjectId)?.name ?? 'Project';

  // Imported PDF library documents (grouped passages) for the active scope.
  const documents = useMemo(
    () => libraryDocuments(scope === 'library' ? undefined : activeProjectId ?? undefined),
    // chunks in deps so the list refreshes after an import or delete.
    [libraryDocuments, chunks, scope, activeProjectId],
  );

  const onFilesChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((f) => /\.pdf$/i.test(f.name));
    event.target.value = ''; // let the same file be re-picked later
    if (files.length === 0 || !activeProjectId || importing) return;
    setImporting(true);
    setImportStatus(`Importing 0/${files.length}…`);
    try {
      const report = await importPdfFiles(files, {
        projectId: activeProjectId,
        onProgress: (p) => setImportStatus(`Importing ${p.index}/${p.total} — ${p.name} (${p.phase})`),
      });
      useToastStore.getState().show(summarizeImport(report), 'info');
      if (report.skipped.length > 0) {
        useToastStore
          .getState()
          .show(`Skipped: ${report.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`, 'error');
      }
      if (report.addedDocuments > 0) setShowDocs(true);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      useToastStore.getState().show(`Import failed: ${detail}`, 'error');
    } finally {
      setImporting(false);
      setImportStatus(null);
    }
  };

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
  const activeChunks = useMemo(
    () => chunks.filter((chunk) => chunk.projectId === activeProjectId),
    [chunks, activeProjectId],
  );

  // ── Prune (preview + undo) ──────────────────────────────────────────────
  // Computing the plan embeds each topic once so the relevance gate is semantic.
  // The vectors are cached so toggling "aggressive" re-plans without re-embedding.
  const [pruneCtx, setPruneCtx] = useState<{
    vectors: Map<string, Float32Array>;
    queryVectors: Map<string, Float32Array>;
  } | null>(null);
  const [pruneAggressive, setPruneAggressive] = useState(false);
  const [pruneComputing, setPruneComputing] = useState(false);
  const [pruneBusy, setPruneBusy] = useState(false);
  const [undoCount, setUndoCount] = useState<number | null>(null);
  // Descriptors of the most recently pruned chunks, so an undo can reverse the
  // reinforcement signal it sent to the learning layer.
  const lastPrunedRef = useRef<{ id: string; source: string }[]>([]);

  const prunePlan = useMemo(
    () =>
      pruneCtx
        ? planPrune(activeChunks, {
            vectors: pruneCtx.vectors,
            queryVectors: pruneCtx.queryVectors,
            aggressive: pruneAggressive,
          })
        : null,
    [pruneCtx, activeChunks, pruneAggressive],
  );

  // The undo offer auto-expires so it never lingers as stale state.
  useEffect(() => {
    if (undoCount === null) return;
    const timer = window.setTimeout(() => setUndoCount(null), 12000);
    return () => window.clearTimeout(timer);
  }, [undoCount]);

  const openPrune = async () => {
    if (!activeProjectId || activeProjectCount === 0 || pruneComputing) return;
    setPruneComputing(true);
    setUndoCount(null);
    try {
      const vectors = getChunkVectors(activeChunks.map((c) => c.id));
      const queryVectors = new Map<string, Float32Array>();
      const queries = [
        ...new Set(activeChunks.map((c) => c.query?.trim()).filter((q): q is string => !!q)),
      ];
      if (queries.length > 0) {
        try {
          const provider = getEmbeddingProvider();
          await provider.warmup();
          if (provider.ready) {
            const vecs = await provider.embed(queries);
            queries.forEach((q, i) => {
              const v = vecs[i];
              if (v) queryVectors.set(q, v);
            });
          }
        } catch {
          // Embedder unavailable — planPrune falls back to the lexical gate.
        }
      }
      setPruneAggressive(false);
      setPruneCtx({ vectors, queryVectors });
    } finally {
      setPruneComputing(false);
    }
  };

  const confirmPrune = (ids: string[]) => {
    setPruneBusy(true);
    // Capture what is being pruned BEFORE removal, so the learning layer can
    // treat the user's curation as an explicit negative reward signal.
    const idSet = new Set(ids);
    const pruned = chunks.filter((c) => idSet.has(c.id)).map((c) => ({ id: c.id, source: c.source }));
    const removed = pruneChunks(ids);
    setPruneBusy(false);
    setPruneCtx(null);
    if (removed > 0) {
      setUndoCount(removed);
      lastPrunedRef.current = pruned;
      useLearningStore.getState().reinforceFromChunks(pruned, 'penalty');
    } else useToastStore.getState().show('Nothing was pruned', 'info');
  };

  const deleteAll = () => {
    if (!activeProjectId || activeProjectCount === 0) return;
    const ok = window.confirm(
      `Delete all ${activeProjectCount} saved ${
        activeProjectCount === 1 ? 'finding' : 'findings'
      } in "${projectName}"? This permanently empties this project's memory and cannot be undone.`,
    );
    if (ok) clearProject(activeProjectId);
  };

  const handleUndo = () => {
    const restored = undoLastPrune();
    setUndoCount(null);
    if (restored > 0 && lastPrunedRef.current.length > 0) {
      // Undoing a prune reverses the signal: the user values these after all.
      useLearningStore.getState().reinforceFromChunks(lastPrunedRef.current, 'reward');
      lastPrunedRef.current = [];
    }
    useToastStore.getState().show(
      restored > 0 ? `Restored ${restored} ${restored === 1 ? 'finding' : 'findings'}` : 'Nothing to restore',
      'info',
    );
  };

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
            <h1>{scope === 'library' ? 'Library' : projectName}</h1>
            <span className="mode-accent-tick" aria-hidden="true" />
            <p className="memory-subtitle">
              <b>{visible.length}</b> {visible.length === 1 ? 'saved finding' : 'saved findings'}
              {scope === 'library' ? ' across all projects' : ''}
              {search.trim() ? ` · matching "${search.trim()}"` : ''}
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
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={(e) => void onFilesChosen(e)}
            />
            <button
              type="button"
              className="memory-import"
              disabled={importing || !activeProjectId}
              title="Add PDF papers from your computer so the Brain knows and can cite them"
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon name={importing ? 'spinner' : 'plus'} size={13} />
              {importing ? 'Importing…' : 'Import papers'}
            </button>
            {documents.length > 0 && (
              <button
                type="button"
                className="memory-import"
                data-active={showDocs}
                title="Show imported papers"
                onClick={() => setShowDocs((v) => !v)}
              >
                <Icon name="book" size={13} /> {documents.length} {documents.length === 1 ? 'paper' : 'papers'}
              </button>
            )}
            <button
              type="button"
              className="memory-prune"
              disabled={activeProjectCount === 0 || pruneComputing}
              title="Review off-topic, duplicate, and meta findings before removing them"
              onClick={() => void openPrune()}
            >
              <Icon name="refresh" size={13} /> {pruneComputing ? 'Analyzing…' : 'Prune'}
            </button>
          </div>
        </header>

        {importStatus && (
          <div className="memory-import-status" role="status">
            <Icon name="spinner" size={13} /> {importStatus}
          </div>
        )}

        {showDocs && documents.length > 0 && (
          <div className="memory-docs" aria-label="Imported papers">
            {documents.map((doc) => (
              <div className="memory-doc" key={doc.docId}>
                <Icon name="book" size={13} />
                <div className="memory-doc-meta">
                  <strong>{doc.title}</strong>
                  <span>
                    {doc.chunkCount} passage{doc.chunkCount === 1 ? '' : 's'} · imported{' '}
                    {new Date(doc.importedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  className="memory-doc-remove"
                  title="Remove this paper from memory"
                  onClick={() => {
                    if (window.confirm(`Remove "${doc.title}" and all its passages from memory?`)) {
                      removeDocument(doc.docId);
                    }
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

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
          <MemoryVectorGraph3D
            chunks={visible}
            onRemove={removeChunk}
            onDeleteAll={deleteAll}
            deleteAllCount={activeProjectCount}
          />
        ) : (
          <div className="memory-list">
            {visible.map((chunk) => (
              <MemoryCard key={chunk.id} chunk={chunk} onRemove={removeChunk} />
            ))}
          </div>
        )}
      </section>

      {prunePlan && (
        <PrunePreview
          plan={prunePlan}
          aggressive={pruneAggressive}
          busy={pruneBusy}
          onAggressiveChange={setPruneAggressive}
          onConfirm={confirmPrune}
          onClose={() => setPruneCtx(null)}
        />
      )}

      {undoCount !== null && (
        <div className="memory-undo" role="status">
          <span>
            Pruned {undoCount} {undoCount === 1 ? 'finding' : 'findings'}
          </span>
          <button type="button" onClick={handleUndo}>
            <Icon name="refresh" size={12} /> Undo
          </button>
        </div>
      )}
    </div>
  );
}
