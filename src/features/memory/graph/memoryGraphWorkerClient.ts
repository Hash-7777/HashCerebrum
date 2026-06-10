// Main-thread client for the memory-graph worker. Manages a single lazy worker
// instance, debounces rapid chunk changes, and surfaces a React-friendly
// { graph, positions, loading, error } state.

import { useEffect, useRef, useState, useCallback } from 'react';
import type { RagChunk } from '@core/rag/types';
import type { MemoryGraph, MemoryGraphEdge, MemoryGraphCluster, MemoryGraphStats, MemoryGraphNode } from './memoryGraph';
import type { NodePosition } from './layout';

interface Pending {
  resolve: (value: BuildResult) => void;
  reject: (error: Error) => void;
}

interface BuildResult {
  graph: MemoryGraph;
  positions: Map<string, NodePosition>;
  span: number;
}

let singletonWorker: Worker | null = null;
let workerUnavailable = false;
let seq = 0;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker | null {
  if (singletonWorker) return singletonWorker;
  if (workerUnavailable || typeof Worker === 'undefined') {
    workerUnavailable = true;
    return null;
  }
  try {
    singletonWorker = new Worker(new URL('../../../workers/memoryGraph.worker.ts', import.meta.url), {
      type: 'module',
    });
    singletonWorker.addEventListener('message', (event) => {
      const data = event.data as { type?: string; id?: number; graph?: unknown; positions?: unknown; span?: number; error?: string } | null;
      if (!data || typeof data.id !== 'number') return;
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.type === 'built' && data.graph && Array.isArray(data.positions)) {
        const g = data.graph as {
          nodes: MemoryGraphNode[];
          edges: MemoryGraphEdge[];
          clusters: MemoryGraphCluster[];
          stats: MemoryGraphStats;
        };
        const positions = new Map<string, NodePosition>(data.positions as [string, NodePosition][]);
        p.resolve({ graph: { ...g, stats: g.stats }, positions, span: data.span ?? 1000 });
      } else if (data.type === 'error') {
        p.reject(new Error(typeof data.error === 'string' ? data.error : 'graph build failed'));
      }
    });
    singletonWorker.addEventListener('error', () => {
      const err = new Error('memory-graph worker crashed');
      for (const p of pending.values()) p.reject(err);
      pending.clear();
    });
    return singletonWorker;
  } catch {
    workerUnavailable = true;
    return null;
  }
}

function buildAsync(chunks: RagChunk[], span: number, maxNodes: number): Promise<BuildResult> {
  const worker = ensureWorker();
  if (!worker) {
    // Worker unavailable (tests, old browser) — fall back to main-thread build.
    return Promise.resolve(fallbackBuild(chunks, span, maxNodes));
  }
  const id = (seq += 1);
  return new Promise<BuildResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: 'build', id, chunks, span, maxNodes });
  });
}

function fallbackBuild(chunks: RagChunk[], span: number, maxNodes: number): BuildResult {
  const { buildMemoryGraph } = require('./memoryGraph');
  const { layoutMemoryGraph } = require('./layout');
  const graph = buildMemoryGraph(chunks.slice(0, maxNodes));
  const positions = layoutMemoryGraph(graph, span);
  return { graph, positions, span };
}

// Low-end device detection: cap nodes when memory is constrained.
function getMaxNodes(): number {
  // @ts-expect-error deviceMemory is non-standard but widely supported.
  const mem = navigator.deviceMemory as number | undefined;
  if (mem && mem <= 4) return 120;
  if (mem && mem <= 8) return 180;
  return 240;
}

/** React hook: builds the memory graph off the main thread with debouncing. */
export function useMemoryGraph(chunks: RagChunk[], debounceMs = 250) {
  const [result, setResult] = useState<BuildResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const maxNodes = useRef(getMaxNodes()).current;

  const trigger = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) {
      abortRef.current();
      abortRef.current = null;
    }
    setLoading(true);
    setError(null);

    timerRef.current = setTimeout(() => {
      const span = Math.max(1200, Math.sqrt(chunks.length) * 110, Math.sqrt(chunks.length) * 540);
      let cancelled = false;
      abortRef.current = () => { cancelled = true; };

      buildAsync(chunks, span, maxNodes)
        .then((res) => {
          if (!cancelled) {
            setResult(res);
            setLoading(false);
          }
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
            setLoading(false);
          }
        })
        .finally(() => {
          if (!cancelled) abortRef.current = null;
        });
    }, debounceMs);
  }, [chunks, debounceMs, maxNodes]);

  useEffect(() => {
    trigger();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) {
        abortRef.current();
        abortRef.current = null;
      }
    };
  }, [trigger]);

  return {
    graph: result?.graph ?? null,
    positions: result?.positions ?? null,
    span: result?.span ?? 1000,
    loading,
    error,
  };
}
