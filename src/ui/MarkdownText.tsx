// Lightweight, dependency-free Markdown renderer for assistant chat text.
//
// The app deliberately avoids a heavy Markdown engine; assistant prose used to
// render as raw text, so the model's **bold**, `code`, [links](…), and bullet
// lists showed their literal syntax. This handles the common inline and block
// constructs and renders to React nodes (never dangerouslySetInnerHTML, so
// there is no HTML-injection surface). Unknown syntax falls through as plain
// text. Drug-interaction reports keep their own structured renderer.

import { Fragment, type ReactNode } from 'react';

// One pass over a line, emitting text and inline-formatted nodes. Order in the
// alternation matters: code and links first, then bold (** / __) before italic
// (*) so the double-marker is not consumed as two italics.
const INLINE = /(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\s]+\))|(\*\*[^*\n]+\*\*|__[^_\n]+__)|(\*[^*\n]+\*)/g;

function safeHref(url: string): string | null {
  const trimmed = url.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  INLINE.lastIndex = 0;
  while ((match = INLINE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const [, code, link, bold, italic] = match;
    const key = `${keyPrefix}-${i++}`;
    if (code) {
      nodes.push(<code key={key}>{code.slice(1, -1)}</code>);
    } else if (link) {
      const close = link.indexOf('](');
      const label = link.slice(1, close);
      const href = safeHref(link.slice(close + 2, -1));
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          link
        ),
      );
    } else if (bold) {
      nodes.push(<strong key={key}>{bold.slice(2, -2)}</strong>);
    } else if (italic) {
      nodes.push(<em key={key}>{italic.slice(1, -1)}</em>);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const UL_RE = /^\s*[-*•]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;

interface Block {
  type: 'p' | 'ul' | 'ol';
  lines: string[];
}

// Group lines into paragraph / list blocks. Blank lines separate blocks; a run
// of list-marker lines becomes a single list.
function toBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };
  for (const raw of content.replace(/\r\n/g, '\n').split('\n')) {
    if (raw.trim() === '') {
      flush();
      continue;
    }
    const ul = UL_RE.exec(raw);
    const ol = ul ? null : OL_RE.exec(raw);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (!current || current.type !== type) {
        flush();
        current = { type, lines: [] };
      }
      current.lines.push((ul ?? ol)![1]!);
    } else {
      if (!current || current.type !== 'p') {
        flush();
        current = { type: 'p', lines: [] };
      }
      current.lines.push(raw);
    }
  }
  flush();
  return blocks;
}

export function MarkdownText({ content }: { content: string }) {
  const blocks = toBlocks(content);
  return (
    <div className="md-text">
      {blocks.map((block, bi) => {
        if (block.type === 'p') {
          return (
            <p key={bi}>
              {block.lines.map((line, li) => (
                <Fragment key={li}>
                  {li > 0 && <br />}
                  {parseInline(line, `${bi}-${li}`)}
                </Fragment>
              ))}
            </p>
          );
        }
        const ListTag = block.type;
        return (
          <ListTag key={bi}>
            {block.lines.map((line, li) => (
              <li key={li}>{parseInline(line, `${bi}-${li}`)}</li>
            ))}
          </ListTag>
        );
      })}
    </div>
  );
}
