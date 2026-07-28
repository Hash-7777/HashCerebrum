// Store for Peer Review mode — holds uploaded or Brain-generated papers and
// their AI critique results. Papers, reviews, edits, and citations persist
// across restarts (durable app storage); the large raw PDF bytes are kept
// separately in IndexedDB (see pdfBlobStore) so the rasterised preview survives a
// restart, while the session-only object URL is rebuilt on demand.

import { create } from 'zustand';
import { platform } from '@platform/index';
import type { EvidenceItem } from '@platform/index';
import type { CitationAudit } from '@features/peer_review/citationGrade';
import { savePdf, deletePdf } from './pdfBlobStore';

export interface AgentReviewResult {
  agentId: string;
  label: string;
  status: 'idle' | 'running' | 'done' | 'error';
  text: string;
  items: string[];
  error?: string;
}

export interface PaperReview {
  score: number; // 1–10
  summary: string;
  strengths: string[];
  weaknesses: string[];
  methodology: string;
  statistics: string;
  conclusions: string;
  publishReadiness: string;
  reviewedAt: string;
  modelUsed: string;
  /** Per-agent swarm results (grammar, originality, vocabulary, stats, overall). */
  agentResults?: AgentReviewResult[];
}

export interface ReviewedPaper {
  id: string;
  title: string;
  filename: string;
  addedAt: string;
  source: 'upload' | 'manuscript';
  // Full text forwarded to the review engine
  text: string;
  /** Latest user-edited plain text. Falls back to `text` before editing. */
  editedText?: string;
  /** Latest user-edited rich HTML from the document editor toolbar. */
  editedHtml?: string;
  // Object URL for the PDF viewer — valid for the current session only
  blobUrl?: string;
  /** Pre-built HTML for the in-app preview iframe (srcDoc).  Tauri's WKWebView
   *  cannot render PDF blobs inline; the HTML path works in every WebView. */
  htmlContent?: string;
  review?: PaperReview;
  reviewStreaming?: boolean;
  reviewError?: string;
  /** Live per-agent swarm progress (set before review completes). */
  reviewAgents?: AgentReviewResult[];
  /** Cited source records (Brain manuscripts) — used to verify each [n] claim
   *  against the snippet it cites. Absent for uploaded PDFs (no sources). */
  citations?: EvidenceItem[];
  /** Result of the citation-faithfulness pass, when sources were available. */
  citationAudit?: CitationAudit;
}

interface PeerReviewStore {
  papers: ReviewedPaper[];
  activePaperId: string | null;
  hydrated: boolean;
  /** Restore persisted papers and their reviews from durable storage. */
  hydrate: () => Promise<void>;
  // Add a paper from a file upload
  addUpload: (file: File) => Promise<string>;
  // Add a paper from a Brain-mode manuscript
  addManuscript: (
    title: string,
    text: string,
    pdfBlob?: Blob,
    htmlContent?: string,
    citations?: EvidenceItem[],
  ) => string;
  setActive: (id: string | null) => void;
  setReview: (id: string, review: PaperReview) => void;
  setReviewStreaming: (id: string, streaming: boolean) => void;
  setReviewError: (id: string, error: string) => void;
  setReviewAgents: (id: string, agents: AgentReviewResult[]) => void;
  setCitationAudit: (id: string, audit: CitationAudit) => void;
  patchReviewAgent: (id: string, agentId: string, patch: Partial<AgentReviewResult>) => void;
  setDocumentDraft: (id: string, text: string, html: string) => void;
  removePaper: (id: string) => void;
}

function uid(): string {
  return `pr-${crypto.randomUUID()}`;
}

// --- persistence ---
// Papers and their reviews survive an app restart. The session-only object URL
// (blobUrl) and transient live-review state (reviewStreaming / reviewAgents /
// reviewError) are dropped — on restore, a manuscript previews from its stored
// htmlContent and an upload from its extracted text, while the completed review,
// edits, citations, and audit are all kept.
const STORAGE_KEY = 'peerReview.v1';

interface PersistShape {
  papers: ReviewedPaper[];
  activePaperId: string | null;
}

function serializePaper(paper: ReviewedPaper): ReviewedPaper {
  const { blobUrl: _b, reviewStreaming: _s, reviewAgents: _a, reviewError: _e, ...rest } = paper;
  return rest;
}

function persist(papers: ReviewedPaper[], activePaperId: string | null) {
  void platform()
    .storage.set<PersistShape>(STORAGE_KEY, { papers: papers.map(serializePaper), activePaperId })
    .catch((err: unknown) => console.error('[peerReviewStore] persist failed:', err));
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

// lopdf's extract_text emits a newline per text run, so a single paragraph
// arrives as many short fragment-lines (and the occasional stranded hyphen).
// Re-flow it into readable paragraphs: rejoin hyphenated splits, then join
// consecutive lines with a space, starting a new paragraph only at a blank
// line or after a line that ends a sentence. Without this the editor and the
// review agents see one fragment per line.
export function normalizeExtractedPdfText(text: string): string {
  const cleaned = text
    .replace(/\r\n?/g, '\n')
    // A hyphen stranded on its own line: "Cross\n-\nSectional" → "Cross-Sectional".
    .replace(/\s*\n\s*-\s*\n\s*/g, '-')
    // A word split across a line break: "under-\nutilized" → "underutilized".
    .replace(/([A-Za-z])-\n+\s*([a-z])/g, '$1$2');

  const paragraphs: string[] = [];
  let current = '';
  const flush = () => {
    const trimmed = current.replace(/[ \t]{2,}/g, ' ').trim();
    if (trimmed) paragraphs.push(trimmed);
    current = '';
  };
  for (const rawLine of cleaned.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    current = current ? `${current} ${line}` : line;
    // A line ending a sentence closes the paragraph.
    if (/[.!?]["')\]]?$/.test(line)) flush();
  }
  flush();
  return paragraphs.join('\n\n').trim();
}

export const usePeerReviewStore = create<PeerReviewStore>((set, get) => {
  const save = () => persist(get().papers, get().activePaperId);
  return {
  papers: [],
  activePaperId: null,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    try {
      const stored = await platform().storage.get<PersistShape>(STORAGE_KEY);
      const papers = Array.isArray(stored?.papers) ? stored.papers : [];
      set({ papers, activePaperId: stored?.activePaperId ?? papers[papers.length - 1]?.id ?? null, hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  addUpload: async (file) => {
    const id = uid();
    const blobUrl = URL.createObjectURL(file);
    try {
      const bytes = await readFileBytes(file);
      const extracted = normalizeExtractedPdfText(
        await platform().pdf.extractTextBytes(file.name, bytes),
      );
      if (extracted.replace(/\s+/g, '').length < 80) {
        throw new Error('No readable text was extracted. The PDF may be scanned or image-only.');
      }
      const paper: ReviewedPaper = {
        id,
        title: file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '),
        filename: file.name,
        addedAt: new Date().toISOString(),
        source: 'upload',
        text: extracted,
        blobUrl,
      };
      set((s) => ({ papers: [...s.papers, paper], activePaperId: id }));
      // Persist the bytes so the rasterised preview survives an app restart.
      void savePdf(id, file);
      save();
      return id;
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`${file.name}: ${detail}`);
    }
  },

  addManuscript: (title, text, pdfBlob, htmlContent, citations) => {
    const id = uid();
    const base: ReviewedPaper = {
      id,
      title,
      filename: `${title.slice(0, 48).replace(/\s+/g, '-')}.pdf`,
      addedAt: new Date().toISOString(),
      source: 'manuscript',
      text,
      ...(htmlContent ? { htmlContent } : {}),
      ...(citations && citations.length > 0 ? { citations } : {}),
    };
    const paper: ReviewedPaper = pdfBlob
      ? { ...base, blobUrl: URL.createObjectURL(pdfBlob) }
      : base;
    set((s) => ({ papers: [...s.papers, paper], activePaperId: id }));
    // Persist the bytes so the rasterised preview survives an app restart.
    if (pdfBlob) void savePdf(id, pdfBlob);
    save();
    return id;
  },

  setActive: (id) => {
    set({ activePaperId: id });
    save();
  },

  setReview: (id, review) => {
    set((s) => ({
      papers: s.papers.map((p) => {
        if (p.id !== id) return p;
        const { reviewStreaming: _s, reviewError: _e, ...rest } = p;
        return { ...rest, review };
      }),
    }));
    save();
  },

  setReviewStreaming: (id, streaming) =>
    set((s) => ({
      papers: s.papers.map((p) => (p.id === id ? { ...p, reviewStreaming: streaming } : p)),
    })),

  setReviewError: (id, error) =>
    set((s) => ({
      papers: s.papers.map((p) =>
        p.id === id ? { ...p, reviewError: error, reviewStreaming: false } : p,
      ),
    })),

  setReviewAgents: (id, agents) =>
    set((s) => ({
      papers: s.papers.map((p) => (p.id === id ? { ...p, reviewAgents: agents } : p)),
    })),

  setCitationAudit: (id, audit) => {
    set((s) => ({
      papers: s.papers.map((p) => (p.id === id ? { ...p, citationAudit: audit } : p)),
    }));
    save();
  },

  patchReviewAgent: (id, agentId, patch) =>
    set((s) => ({
      papers: s.papers.map((p) => {
        if (p.id !== id) return p;
        const agents = (p.reviewAgents ?? []).map((a) =>
          a.agentId === agentId ? { ...a, ...patch } : a,
        );
        return { ...p, reviewAgents: agents };
      }),
    })),

  setDocumentDraft: (id, text, html) => {
    set((s) => ({
      papers: s.papers.map((p) => (p.id === id ? { ...p, editedText: text, editedHtml: html } : p)),
    }));
    save();
  },

  removePaper: (id) => {
    void deletePdf(id);
    set((s) => {
      const paper = s.papers.find((p) => p.id === id);
      if (paper?.blobUrl) URL.revokeObjectURL(paper.blobUrl);
      const papers = s.papers.filter((p) => p.id !== id);
      const activePaperId = s.activePaperId === id
        ? (papers[papers.length - 1]?.id ?? null)
        : s.activePaperId;
      return { papers, activePaperId };
    });
    save();
  },
  };
});
