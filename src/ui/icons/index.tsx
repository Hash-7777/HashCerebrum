// Inline SVG icon registry. Stroke-based 24x24 line icons, colorless
// (`currentColor`) so they inherit from text. Adding a new icon is a
// one-entry change here — never import an emoji font and never use a
// glyph as a label substitute.

import type { ComponentType, SVGProps } from 'react';

export type IconName =
  | 'brain'
  | 'agent'
  | 'flask'
  | 'pill'
  | 'dna'
  | 'book'
  | 'quote'
  | 'shield'
  | 'search'
  | 'send'
  | 'settings'
  | 'close'
  | 'pulse'
  | 'document'
  | 'trial'
  | 'database'
  | 'spinner'
  | 'check'
  | 'alert'
  | 'lock'
  | 'eye'
  | 'gauge'
  | 'plus'
  | 'minus'
  | 'copy'
  | 'edit'
  | 'refresh'
  | 'download'
  | 'graph'
  | 'list'
  | 'chevDown'
  | 'activity'
  | 'filePdf';

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  name: IconName;
  size?: number;
  label?: string;
}

const PATHS: Record<IconName, ComponentType<SVGProps<SVGSVGElement>>> = {
  brain: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M9 4.5a2.5 2.5 0 0 0-2.5 2.5v.4A2.5 2.5 0 0 0 5 9.5a2.5 2.5 0 0 0 1 2 2.5 2.5 0 0 0 .5 4.5v.5A2.5 2.5 0 0 0 9 19a2.5 2.5 0 0 0 2.5-2.5V7A2.5 2.5 0 0 0 9 4.5Z" />
      <path d="M15 4.5a2.5 2.5 0 0 1 2.5 2.5v.4A2.5 2.5 0 0 1 19 9.5a2.5 2.5 0 0 1-1 2 2.5 2.5 0 0 1-.5 4.5v.5A2.5 2.5 0 0 1 15 19a2.5 2.5 0 0 1-2.5-2.5V7A2.5 2.5 0 0 1 15 4.5Z" />
      <path d="M9 9h1.5M9 13h1.5M15 9h-1.5M15 13h-1.5" />
    </svg>
  ),
  agent: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="8" r="3.2" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
    </svg>
  ),
  flask: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M9 3h6M10 3v6.5L5 18a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3L14 9.5V3" />
      <path d="M7.5 14.5h9" />
    </svg>
  ),
  pill: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      {/* A clean diagonal capsule split across the middle (both the body and the
          divider live in one rotated group, so the divider always lands square
          on the centre — the old separate diagonal line looked broken). */}
      <g transform="rotate(45 12 12)">
        <rect x="3" y="8" width="18" height="8" rx="4" />
        <line x1="12" y1="8" x2="12" y2="16" />
      </g>
    </svg>
  ),
  book: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4 4.5C4 3.7 4.7 3 5.5 3H11v15H5.5C4.7 18 4 18.7 4 19.5V4.5Z" />
      <path d="M20 4.5C20 3.7 19.3 3 18.5 3H13v15h5.5c.8 0 1.5.7 1.5 1.5V4.5Z" />
      <path d="M4 19.5C4 20.3 4.7 21 5.5 21h13c.8 0 1.5-.7 1.5-1.5" />
    </svg>
  ),
  dna: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      {/* Two sine-like strands with base-pair rungs — a compact double helix. */}
      <path d="M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9" />
      <path d="M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9" />
      <path d="M9.2 6h5.6M9.2 18h5.6M7.7 9.5h8.6M7.7 14.5h8.6" />
    </svg>
  ),
  quote: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M7 7H4v5h3l-2 5M17 7h-3v5h3l-2 5" />
    </svg>
  ),
  shield: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 3 4 6v6c0 4.6 3.4 8.4 8 9 4.6-.6 8-4.4 8-9V6l-8-3Z" />
      <path d="M9.5 12.2l1.8 1.8 3.4-3.4" />
    </svg>
  ),
  search: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.3-4.3" />
    </svg>
  ),
  send: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M5 12h13" />
      <path d="m13 6 6 6-6 6" />
      <path d="M5 5.5v13" />
    </svg>
  ),
  settings: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  close: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  pulse: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M3 12h4l2-7 4 14 2-7h6" />
    </svg>
  ),
  document: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  ),
  trial: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9h17M8 12.5h4M8 16h7" />
    </svg>
  ),
  database: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" />
      <path d="M4.5 11.5v6c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-6" />
    </svg>
  ),
  spinner: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  ),
  check: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="m5 12 5 5 9-11" />
    </svg>
  ),
  alert: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4M12 17v.5" />
    </svg>
  ),
  lock: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  ),
  eye: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M2.5 12C5 7.5 8.5 5.5 12 5.5s7 2 9.5 6.5C19 16.5 15.5 18.5 12 18.5S5 16.5 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  gauge: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M4.2 16a8.5 8.5 0 1 1 15.6 0" />
      <path d="M12 12.5 16 8" />
      <path d="M8 19h8" />
    </svg>
  ),
  plus: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  minus: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M5 12h14" />
    </svg>
  ),
  copy: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M4 16V6a2 2 0 0 1 2-2h10" />
    </svg>
  ),
  edit: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  ),
  refresh: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18 11a6.5 6.5 0 0 0-11-3.8L4 10" />
      <path d="M6 13a6.5 6.5 0 0 0 11 3.8l3-2.8" />
    </svg>
  ),
  download: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M12 3v11" />
      <path d="m7 9 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  ),
  graph: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M8.1 6.9 15.7 6M7 9.3l4.1 6.4M16.8 8.2 13.1 15.6" />
      <circle cx="6" cy="6.6" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="12" cy="17.6" r="2.5" />
    </svg>
  ),
  list: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.6" cy="6" r="1.3" />
      <circle cx="4.6" cy="12" r="1.3" />
      <circle cx="4.6" cy="18" r="1.3" />
    </svg>
  ),
  chevDown: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  activity: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  // Document with folded corner + P D F letter strokes in the body
  filePdf: (p) => (
    <svg viewBox="0 0 24 24" {...p}>
      <path d="M6 2h9l4 4v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M15 2v4h4" />
      {/* P */}
      <path d="M8 12.5v4" />
      <path d="M8 12.5h1.3a1 1 0 0 1 0 1.8H8" />
      {/* D */}
      <path d="M11.2 12.5v4" />
      <path d="M11.2 12.5q2.5 0 2.5 2t-2.5 2" />
      {/* F */}
      <path d="M15.2 12.5v4M15.2 12.5h1.6M15.2 14.3h1.2" />
    </svg>
  ),
};

export function Icon({ name, size = 16, label, ...rest }: IconProps) {
  const Component = PATHS[name];
  return (
    <Component
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      {...rest}
    />
  );
}
