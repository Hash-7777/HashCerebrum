/**
 * Citation Traverser — follow in-memory references from retrieved chunks.
 *
 * When a chunk mentions a PMID or DOI, this module looks for that identifier
 * in the RAG store and returns the referenced chunk(s) as additional context.
 *
 * Zero model calls. Pure identifier matching.
 */

import type { RagChunk, RagSearchHit } from '../types';
import { useRagStore } from '../store/ragStore';

const PMID_RX = /\bPMID\s*:?\s*(\d{5,10})\b/gi;
const DOI_RX = /\b(?:doi\.org\/|DOI\s*:?\s*|https?:\/\/doi\.org\/)(10\.\d{4,}\/[^\s"'<>]+)/gi;
const NCT_RX = /\b(NCT\d{8,12})\b/gi;

export interface CitationReference {
  type: 'pmid' | 'doi' | 'nct';
  id: string;
  sourceChunkId: string;
  context: string; // sentence containing the citation
}

export interface TraversalResult {
  references: CitationReference[];
  resolvedHits: RagSearchHit[];
  unresolved: CitationReference[];
}

function extractReferences(chunk: RagChunk): CitationReference[] {
  const refs: CitationReference[] = [];
  const text = chunk.text;
  // Use the full text for extraction; sentence splitting breaks DOIs/URLs
  // that contain periods. Context is captured as a window around the match.
  let m: RegExpExecArray | null;

  PMID_RX.lastIndex = 0;
  while ((m = PMID_RX.exec(text)) !== null) {
    const context = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).trim();
    refs.push({ type: 'pmid', id: m[1]!, sourceChunkId: chunk.id, context });
  }

  DOI_RX.lastIndex = 0;
  while ((m = DOI_RX.exec(text)) !== null) {
    const context = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).trim();
    refs.push({ type: 'doi', id: m[1]!.toLowerCase(), sourceChunkId: chunk.id, context });
  }

  NCT_RX.lastIndex = 0;
  while ((m = NCT_RX.exec(text)) !== null) {
    const context = text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).trim();
    refs.push({ type: 'nct', id: m[1]!.toUpperCase(), sourceChunkId: chunk.id, context });
  }

  return refs;
}

function resolveReference(ref: CitationReference, allChunks: RagChunk[]): RagSearchHit | undefined {
  for (const chunk of allChunks) {
    if (chunk.id === ref.sourceChunkId) continue; // skip self
    if (ref.type === 'pmid' && chunk.pmid?.toLowerCase() === ref.id.toLowerCase()) {
      return { chunk, score: 1.0 };
    }
    if (ref.type === 'doi' && chunk.doi?.toLowerCase() === ref.id) {
      return { chunk, score: 1.0 };
    }
    // NCT is stored in url or identifiers; check url for NCT number
    if (ref.type === 'nct' && (chunk.url?.toUpperCase().includes(ref.id) || chunk.text.toUpperCase().includes(ref.id))) {
      return { chunk, score: 1.0 };
    }
  }
  return undefined;
}

export function traverseCitations(
  chunks: RagChunk[],
  allChunks?: RagChunk[],
): TraversalResult {
  const refs = chunks.flatMap((chunk) => extractReferences(chunk));
  const resolved: RagSearchHit[] = [];
  const unresolved: CitationReference[] = [];
  const seen = new Set<string>();

  const pool = allChunks ?? useRagStore.getState().chunks ?? chunks;

  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hit = resolveReference(ref, pool);
    if (hit) {
      resolved.push(hit);
    } else {
      unresolved.push(ref);
    }
  }

  return { references: refs, resolvedHits: resolved, unresolved };
}
