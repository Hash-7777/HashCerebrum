// Import orchestrator — drives local PDF files through the deterministic
// ingestion pipeline (NO model: hash → extract → clean → chunk) and into the RAG
// store as library documents. Every step is system code; the only model that
// ever touches the text is the background embedder the store already runs to
// make passages searchable. Per-file failures (scanned, encrypted, empty, too
// big) are recorded as skips with a reason so one bad PDF never aborts a batch.

import { platform } from '@platform/index';
import {
  chunkDocument,
  cleanPdfText,
  deriveDocMeta,
  hashBytes,
  textQuality,
  useRagStore,
  type NewRagChunk,
} from '@core/rag';

/** Library document source label (kept in one place). */
export const LIBRARY_SOURCE = 'library';

const MAX_FILE_BYTES = 40 * 1024 * 1024; // 40 MB per file

export type ImportPhase = 'reading' | 'extracting' | 'indexing';

export interface ImportProgress {
  index: number; // 1-based
  total: number;
  name: string;
  phase: ImportPhase;
}

export interface ImportSkip {
  name: string;
  reason: string;
}

export interface ImportReport {
  addedDocuments: number;
  addedPassages: number;
  duplicates: string[]; // filenames already in the library
  skipped: ImportSkip[];
}

export interface ImportOptions {
  projectId: string;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
}

function existingDocIds(): Set<string> {
  const ids = new Set<string>();
  for (const c of useRagStore.getState().chunks) if (c.docId) ids.add(c.docId);
  return ids;
}

/**
 * Import a list of PDF files into the active project's library. Resolves with a
 * report; never throws for a single bad file.
 */
export async function importPdfFiles(files: File[], opts: ImportOptions): Promise<ImportReport> {
  const report: ImportReport = { addedDocuments: 0, addedPassages: 0, duplicates: [], skipped: [] };
  const total = files.length;
  const seenThisBatch = new Set<string>();

  for (let i = 0; i < files.length; i += 1) {
    if (opts.signal?.aborted) break;
    const file = files[i]!;
    const emit = (phase: ImportPhase) => opts.onProgress?.({ index: i + 1, total, name: file.name, phase });

    try {
      emit('reading');
      if (file.size > MAX_FILE_BYTES) {
        report.skipped.push({ name: file.name, reason: 'file is larger than 40 MB' });
        continue;
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const docId = await hashBytes(bytes);
      if (existingDocIds().has(docId) || seenThisBatch.has(docId)) {
        report.duplicates.push(file.name);
        continue;
      }
      seenThisBatch.add(docId);

      emit('extracting');
      let raw: string;
      try {
        raw = await platform().pdf.extractTextBytes(file.name, bytes);
      } catch {
        report.skipped.push({ name: file.name, reason: 'could not be read — it may be encrypted or corrupt' });
        continue;
      }

      const cleaned = cleanPdfText(raw);
      const quality = textQuality(cleaned);
      if (!quality.ok) {
        report.skipped.push({ name: file.name, reason: quality.reason ?? 'no readable text' });
        continue;
      }

      const meta = deriveDocMeta(file.name, cleaned);
      const passages = chunkDocument(cleaned);
      const newChunks: NewRagChunk[] = passages.map((p) => ({
        kind: 'document',
        title: meta.title,
        text: p.text,
        source: LIBRARY_SOURCE,
        query: meta.title,
        docId,
        chunkIndex: p.chunkIndex,
        evidenceStrength: 'moderate',
        ...(meta.year ? { year: meta.year } : {}),
        ...(meta.doi ? { doi: meta.doi } : {}),
      }));
      if (newChunks.length === 0) {
        report.skipped.push({ name: file.name, reason: 'no passages could be extracted' });
        continue;
      }

      emit('indexing');
      useRagStore.getState().addChunks(opts.projectId, newChunks);
      report.addedDocuments += 1;
      report.addedPassages += newChunks.length;
    } catch (err) {
      report.skipped.push({
        name: file.name,
        reason: err instanceof Error ? err.message : 'unexpected error',
      });
    }
  }

  return report;
}

/** A short human summary of an import for a toast. */
export function summarizeImport(report: ImportReport): string {
  const parts: string[] = [];
  if (report.addedDocuments > 0) {
    parts.push(`Added ${report.addedPassages} passage${report.addedPassages === 1 ? '' : 's'} from ${report.addedDocuments} paper${report.addedDocuments === 1 ? '' : 's'}`);
  }
  if (report.duplicates.length > 0) parts.push(`${report.duplicates.length} already in library`);
  if (report.skipped.length > 0) parts.push(`${report.skipped.length} skipped`);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing to import.';
}
