// In-memory store for Peer Review mode — holds uploaded or Brain-generated
// papers and their AI critique results. Not persisted; PDF blobs can be large
// and are re-supplied each session.

import { create } from 'zustand';

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
}

export interface ReviewedPaper {
  id: string;
  title: string;
  filename: string;
  addedAt: string;
  source: 'upload' | 'manuscript';
  // Full text forwarded to the review engine
  text: string;
  // Object URL for the PDF viewer — valid for the current session only
  blobUrl?: string;
  review?: PaperReview;
  reviewStreaming?: boolean;
  reviewError?: string;
}

interface PeerReviewStore {
  papers: ReviewedPaper[];
  activePaperId: string | null;
  // Add a paper from a file upload
  addUpload: (file: File) => Promise<string>;
  // Add a paper from a Brain-mode manuscript
  addManuscript: (title: string, text: string, pdfBlob?: Blob) => string;
  setActive: (id: string | null) => void;
  setReview: (id: string, review: PaperReview) => void;
  setReviewStreaming: (id: string, streaming: boolean) => void;
  setReviewError: (id: string, error: string) => void;
  removePaper: (id: string) => void;
}

function uid(): string {
  return `pr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

export const usePeerReviewStore = create<PeerReviewStore>((set) => ({
  papers: [],
  activePaperId: null,

  addUpload: async (file) => {
    const id = uid();
    const blobUrl = URL.createObjectURL(file);
    // Read text for review engine (best-effort — PDFs will be garbled, but
    // the user can also paste text; for now we store raw bytes as text and
    // the review engine handles what it gets).
    let text = '';
    try {
      text = await readFileAsText(file);
    } catch {
      text = `[Binary file: ${file.name}]`;
    }
    const paper: ReviewedPaper = {
      id,
      title: file.name.replace(/\.pdf$/i, '').replace(/[-_]/g, ' '),
      filename: file.name,
      addedAt: new Date().toISOString(),
      source: 'upload',
      text,
      blobUrl,
    };
    set((s) => ({ papers: [...s.papers, paper], activePaperId: id }));
    return id;
  },

  addManuscript: (title, text, pdfBlob) => {
    const id = uid();
    const base: ReviewedPaper = {
      id,
      title,
      filename: `${title.slice(0, 48).replace(/\s+/g, '-')}.pdf`,
      addedAt: new Date().toISOString(),
      source: 'manuscript',
      text,
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
