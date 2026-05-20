// Project-memory tools — let the research agent query the active project's
// RAG store before reaching for external databases. Retrieval is fully
// client-side and offline (see ragStore.ts); no network, no IPC.

import { useProjectStore } from '@core/store/projectStore';
import { useRagStore, type RagSearchHit } from '@core/store/ragStore';
import { tools } from './ToolRegistry';

const LIMIT_DEFAULT = 6;
const LIMIT_MAX = 12;
const EXCERPT_CHARS = 280;

const ragSearchSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    limit: { type: 'integer', minimum: 1, maximum: LIMIT_MAX },
  },
};

export interface RagSearchToolResult {
  source: 'rag';
  count: number;
  text: string;
}

function formatHits(hits: RagSearchHit[]): string {
  if (hits.length === 0) {
    return 'Project memory: no earlier research in this project matches the query.';
  }
  const lines = hits.map((hit) => {
    const chunk = hit.chunk;
    const tag = chunk.kind === 'answer' ? 'prior answer' : chunk.source.toUpperCase();
    const excerpt = chunk.text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
    return `- (${tag}) ${chunk.title} — ${excerpt}`;
  });
  return `Project memory — ${hits.length} earlier finding(s) in this project:\n${lines.join('\n')}`;
}

export function registerMemoryTools() {
  if (tools.get('rag_search')) return;

  tools.register<{ query?: unknown; limit?: unknown }, RagSearchToolResult>({
    name: 'rag_search',
    description:
      "Search this project's saved research memory — evidence and answers from earlier research runs in the same project. Call this before the external database tools to reuse prior findings and avoid repeating searches.",
    parameters: ragSearchSchema,
    execute: async (args) => {
      const raw = (args ?? {}) as { query?: unknown; limit?: unknown };
      const query = typeof raw.query === 'string' ? raw.query.trim() : '';
      if (!query) throw new Error('query is required');
      const parsedLimit = Number(raw.limit);
      const limit = Number.isFinite(parsedLimit)
        ? Math.min(LIMIT_MAX, Math.max(1, Math.round(parsedLimit)))
        : LIMIT_DEFAULT;
      const projectId = useProjectStore.getState().activeProjectId ?? '';
      const hits = projectId ? useRagStore.getState().search(projectId, query, limit) : [];
      return { source: 'rag', count: hits.length, text: formatHits(hits) };
    },
  });
}
