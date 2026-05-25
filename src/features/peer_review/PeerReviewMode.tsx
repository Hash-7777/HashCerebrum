import { useRef } from 'react';
import { usePeerReviewStore } from '@core/store/peerReviewStore';
import { useToastStore } from '@core/store/toastStore';
import { Icon } from '@ui/icons';
import { PaperCard } from './components/PaperCard';
import { ReviewWindow } from './components/ReviewWindow';

export default function PeerReviewMode() {
  const papers = usePeerReviewStore((s) => s.papers);
  const activePaperId = usePeerReviewStore((s) => s.activePaperId);
  const addUpload = usePeerReviewStore((s) => s.addUpload);
  const setActive = usePeerReviewStore((s) => s.setActive);
  const removePaper = usePeerReviewStore((s) => s.removePaper);
  const fileRef = useRef<HTMLInputElement>(null);

  const activePaper = papers.find((p) => p.id === activePaperId) ?? null;

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
        useToastStore.getState().show(`${file.name}: only PDF files are supported`, 'error');
        continue;
      }
      try {
        await addUpload(file);
      } catch (err) {
        const detail = err instanceof Error ? err.message : `Failed to import ${file.name}`;
        useToastStore.getState().show(detail, 'error');
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div className="mode mode-peer-review" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      {activePaper && (
        <ReviewWindow paper={activePaper} onClose={() => setActive(null)} />
      )}

      <header className="peer-review-header">
        <div>
          <h2>Peer Review</h2>
          <p className="peer-review-subtitle">
            AI-driven critique, scoring, and publication guidance for research papers
          </p>
        </div>
        <button
          type="button"
          className="peer-review-import-btn"
          onClick={() => fileRef.current?.click()}
        >
          <Icon name="plus" size={14} /> Import PDF
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </header>

      {papers.length === 0 ? (
        <div className="peer-review-empty">
          <Icon name="document" size={40} />
          <p>No papers yet</p>
          <p className="peer-review-empty-hint">
            Use <strong>Import PDF</strong> above, or click <strong>Review</strong> on any Brain research result.
          </p>
        </div>
      ) : (
        <div className="peer-review-grid">
          {papers.map((paper) => (
            <PaperCard
              key={paper.id}
              paper={paper}
              active={paper.id === activePaperId}
              onClick={() => setActive(paper.id)}
              onRemove={() => removePaper(paper.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
