// In-memory store for Peer Review mode — holds uploaded or Brain-generated
// papers and their AI critique results. Not persisted; PDF blobs can be large
// and are re-supplied each session.

import { create } from 'zustand';
import { platform } from '@platform/index';

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
}

interface PeerReviewStore {
  papers: ReviewedPaper[];
  activePaperId: string | null;
  // Add a paper from a file upload
  addUpload: (file: File) => Promise<string>;
  // Add a paper from a Brain-mode manuscript
  addManuscript: (title: string, text: string, pdfBlob?: Blob, htmlContent?: string) => string;
  setActive: (id: string | null) => void;
  setReview: (id: string, review: PaperReview) => void;
  setReviewStreaming: (id: string, streaming: boolean) => void;
  setReviewError: (id: string, error: string) => void;
  setReviewAgents: (id: string, agents: AgentReviewResult[]) => void;
  patchReviewAgent: (id: string, agentId: string, patch: Partial<AgentReviewResult>) => void;
  setDocumentDraft: (id: string, text: string, html: string) => void;
  removePaper: (id: string) => void;
}

function uid(): string {
  return `pr-${crypto.randomUUID()}`;
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

function normalizeExtractedPdfText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export const usePeerReviewStore = create<PeerReviewStore>((set) => ({
  papers: [],
  activePaperId: null,

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
      return id;
    } catch (err) {
      URL.revokeObjectURL(blobUrl);
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(`${file.name}: ${detail}`);
    }
  },

  addManuscript: (title, text, pdfBlob, htmlContent) => {
    const id = uid();
    const base: ReviewedPaper = {
      id,
      title,
      filename: `${title.slice(0, 48).replace(/\s+/g, '-')}.pdf`,
      addedAt: new Date().toISOString(),
      source: 'manuscript',
      text,
      ...(htmlContent ? { htmlContent } : {}),
    };
    const paper: ReviewedPaper = pdfBlob
      ? { ...base, blobUrl: URL.createObjectURL(pdfBlob) }
      : base;
    set((s) => ({ papers: [...s.papers, paper], activePaperId: id }));
    return id;
  },

  setActive: (id) => set({ activePaperId: id }),

  setReview: (id, review) =>
    set((s) => ({
      papers: s.papers.map((p) => {
        if (p.id !== id) return p;
        const { reviewStreaming: _s, reviewError: _e, ...rest } = p;
        return { ...rest, review };
      }),
    })),

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

  setDocumentDraft: (id, text, html) =>
    set((s) => ({
      papers: s.papers.map((p) => (p.id === id ? { ...p, editedText: text, editedHtml: html } : p)),
    })),

  removePaper: (id) =>
    set((s) => {
      const paper = s.papers.find((p) => p.id === id);
      if (paper?.blobUrl) URL.revokeObjectURL(paper.blobUrl);
      const papers = s.papers.filter((p) => p.id !== id);
      const activePaperId = s.activePaperId === id
        ? (papers[papers.length - 1]?.id ?? null)
        : s.activePaperId;
      return { papers, activePaperId };
    }),
}));
