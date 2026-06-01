// Project-memory tools — let the research agent query the active project's
// RAG store before reaching for external databases. Retrieval is fully
// client-side and offline (see ragStore.ts); no network, no IPC.

import { useProjectStore } from '@core/store/projectStore';
import { retrieve, type RagSearchHit } from '@core/rag';
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

function formatHits(hits: RagSearchHit[], activeProjectId: string): string {
  if (hits.length === 0) {
    return 'Project memory: no earlier research matches the query.';
  }
  const lines = hits.map((hit) => {
    const chunk = hit.chunk;
    const tag = chunk.kind === 'answer' ? 'prior answer' : chunk.source.toUpperCase();
    const scope = chunk.projectId === activeProjectId ? '' : ' [other project]';
    const excerpt = chunk.text.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_CHARS);
    return `- (${tag}${scope}) ${chunk.title} — ${excerpt}`;
  });
  return `Project memory — ${hits.length} relevant earlier finding(s):\n${lines.join('\n')}`;
}

export function registerMemoryTools() {
  if (tools.get('rag_search')) return;

  tools.register<{ query?: unknown; limit?: unknown }, RagSearchToolResult>({
    name: 'rag_search',
    description:
      "Search the saved research memory — evidence and answers from earlier research runs — by meaning, not just keywords. Spans all of your projects but ranks findings from the current project first. Call this before the external database tools to reuse prior findings and avoid repeating searches.",
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
      const hits = projectId ? await retrieve(query, { activeProjectId: projectId, limit }) : [];
      return { source: 'rag', count: hits.length, text: formatHits(hits, projectId) };
    },
  });
}
