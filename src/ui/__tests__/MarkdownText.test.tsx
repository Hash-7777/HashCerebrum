import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownText } from '../MarkdownText';

const html = (content: string) => renderToStaticMarkup(<MarkdownText content={content} />);

describe('MarkdownText', () => {
  it('renders bold, italic, and inline code', () => {
    expect(html('Made by **Dr. Seif Hashish**.')).toContain('<strong>Dr. Seif Hashish</strong>');
    expect(html('a *very* important point')).toContain('<em>very</em>');
    expect(html('run `cargo test` now')).toContain('<code>cargo test</code>');
  });

  it('renders safe links and leaves unsafe schemes as text', () => {
    expect(html('see [PubMed](https://pubmed.ncbi.nlm.nih.gov)')).toContain(
      '<a href="https://pubmed.ncbi.nlm.nih.gov"',
    );
    const unsafe = html('click [here](javascript:alert(1))');
    expect(unsafe).not.toContain('<a');
    expect(unsafe).toContain('[here](javascript:alert(1))');
  });

  it('renders unordered and ordered lists', () => {
    const ul = html('- first\n- second');
    expect(ul).toContain('<ul>');
    expect(ul).toContain('<li>first</li>');
    const ol = html('1. one\n2. two');
    expect(ol).toContain('<ol>');
    expect(ol).toContain('<li>one</li>');
  });

  it('separates paragraphs on blank lines', () => {
    const out = html('Para one.\n\nPara two.');
    expect((out.match(/<p>/g) ?? []).length).toBe(2);
  });

  it('never emits raw HTML from the content (no injection)', () => {
    const out = html('hello <img src=x onerror=alert(1)> world');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('leaves plain text without markdown untouched', () => {
    expect(html('just a normal sentence')).toContain('just a normal sentence');
  });
});
