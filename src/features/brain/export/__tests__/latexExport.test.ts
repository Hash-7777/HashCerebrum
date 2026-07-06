import { describe, expect, it } from 'vitest';
import { escapeLatex, markdownToLatex } from '../latexExport';

describe('escapeLatex', () => {
  it('escapes the LaTeX special characters', () => {
    expect(escapeLatex('50% of A&B costs $5 #1 ~x ^y _z {q}')).toBe(
      '50\\% of A\\&B costs \\$5 \\#1 \\textasciitilde{}x \\textasciicircum{}y \\_z \\{q\\}',
    );
  });
});

describe('markdownToLatex', () => {
  it('maps headings to sectioning commands', () => {
    expect(markdownToLatex('# Title')).toContain('\\section*{Title}');
    expect(markdownToLatex('### Sub')).toContain('\\subsection*{Sub}');
  });

  it('converts bold/italic inline marks', () => {
    const out = markdownToLatex('This is **bold** and *italic* text.');
    expect(out).toContain('\\textbf{bold}');
    expect(out).toContain('\\emph{italic}');
  });

  it('wraps bullet and numbered lists in the right environment', () => {
    const bullets = markdownToLatex('- one\n- two');
    expect(bullets).toContain('\\begin{itemize}');
    expect(bullets).toContain('\\item one');
    expect(bullets).toContain('\\end{itemize}');

    const ordered = markdownToLatex('1. first\n2. second');
    expect(ordered).toContain('\\begin{enumerate}');
    expect(ordered).toContain('\\item first');
  });

  it('escapes special characters in body text', () => {
    expect(markdownToLatex('Risk rose 5% with co-therapy.')).toContain('5\\% with');
  });

  it('converts a Markdown reference link to \\href without mangling the URL', () => {
    const out = markdownToLatex('1. Author A. A study title. 2024. [10.1/abc](https://doi.org/10.1%2Fabc)');
    expect(out).toContain('\\href{https://doi.org/10.1\\%2Fabc}{10.1/abc}');
    // The special char in the URL is escaped for hyperref, not with the body
    // \% path, and the label is still present.
    expect(out).not.toContain('LINK');
  });
});
