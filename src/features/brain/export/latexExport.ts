// LaTeX export — converts a manuscript/answer (already rendered to Markdown with
// the chosen citation style and a numbered reference list) into a standalone
// `article` .tex document. Pure and dependency-free: the Markdown→LaTeX pass is
// unit-tested. We deliberately reuse the Markdown export as the single source of
// truth so the LaTeX body and references match every other format exactly.

import { buildMarkdownExport, downloadTextFile, slugifyFilename, type ExportableMessage } from './messageExport';

/** Escape the ten LaTeX special characters in body text. */
export function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// Inline markdown (bold/italic/code) → LaTeX, applied after escaping so the
// emphasis braces we add are not themselves escaped.
function inlineToLatex(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '\\textbf{$1}')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1\\emph{$2}')
    .replace(/`([^`]+)`/g, '\\texttt{$1}');
}

function headingCommand(level: number): string {
  if (level <= 1) return 'section*';
  if (level === 2) return 'section*';
  if (level === 3) return 'subsection*';
  return 'subsubsection*';
}

/** Convert a Markdown string into a LaTeX body (no preamble). */
export function markdownToLatex(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let listKind: 'itemize' | 'enumerate' | null = null;

  const closeList = () => {
    if (listKind) {
      out.push(`\\end{${listKind}}`);
      listKind = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const cmd = headingCommand(heading[1]!.length);
      out.push(`\\${cmd}{${inlineToLatex(escapeLatex(heading[2]!.trim()))}}`);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const kind = bullet ? 'itemize' : 'enumerate';
      if (listKind && listKind !== kind) closeList();
      if (!listKind) {
        listKind = kind;
        out.push(`\\begin{${kind}}`);
      }
      const item = (bullet ? bullet[1]! : ordered![1]!).trim();
      out.push(`  \\item ${inlineToLatex(escapeLatex(item))}`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      out.push('');
      continue;
    }
    closeList();
    out.push(inlineToLatex(escapeLatex(line)));
  }
  closeList();
  // Collapse 3+ blank lines to a single paragraph break.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Build a complete, compilable standalone `article` .tex document. */
export function buildLatexExport(message: ExportableMessage): string {
  const title = escapeLatex(message.title || 'HashCerebrum Export');
  const markdown = buildMarkdownExport(message);
  // Drop the leading "# Title" line — the title is set via \title/\maketitle.
  const withoutTitle = markdown.replace(/^#\s+.*\n+/, '');
  const body = markdownToLatex(withoutTitle);
  return `\\documentclass[11pt]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[margin=1in]{geometry}
\\usepackage{hyperref}
\\usepackage{enumitem}
\\title{${title}}
\\author{}
\\date{\\today}
\\begin{document}
\\maketitle
${body}
\\end{document}
`;
}

export function exportMessageLatex(message: ExportableMessage): void {
  downloadTextFile(`${slugifyFilename(message.title)}.tex`, buildLatexExport(message), 'application/x-tex;charset=utf-8');
}
