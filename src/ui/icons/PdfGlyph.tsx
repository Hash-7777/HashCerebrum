import { useId } from 'react';

// Document glyph used to represent generated PDFs across the app (chat export
// action, document preview). Cream page + red "PDF" badge. The gradient id is
// per-instance (useId) so many glyphs can render on one screen independently.
export function PdfGlyph({ size = 22 }: { size?: number }) {
  const gid = useId();
  const height = Math.round((size * 28) / 22);
  return (
    <svg width={size} height={height} viewBox="0 0 40 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fbf3e6" />
          <stop offset="100%" stopColor="#e6d9be" />
        </linearGradient>
      </defs>
      <path
        d="M4 2h22l10 10v32a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        fill={`url(#${gid})`}
        stroke="rgba(60,40,15,0.18)"
      />
      <path d="M26 2v8a2 2 0 0 0 2 2h8" fill="rgba(60,40,15,0.06)" stroke="rgba(60,40,15,0.18)" />
      <line x1="8" y1="20" x2="32" y2="20" stroke="rgba(60,40,15,0.32)" strokeWidth="1.4" />
      <line x1="8" y1="24" x2="28" y2="24" stroke="rgba(60,40,15,0.22)" strokeWidth="1.2" />
      <line x1="8" y1="28" x2="32" y2="28" stroke="rgba(60,40,15,0.22)" strokeWidth="1.2" />
      <rect x="4" y="38" width="22" height="8" rx="1.5" fill="#c0322a" />
      <text
        x="15"
        y="44.3"
        textAnchor="middle"
        fontFamily="IBM Plex Mono, ui-monospace, monospace"
        fontSize="6.4"
        fontWeight="700"
        fill="#fff"
        letterSpacing="0.5"
      >
        PDF
      </text>
    </svg>
  );
}
