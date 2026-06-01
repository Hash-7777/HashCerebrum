import { describe, expect, it } from 'vitest';
import { normalizeOllamaHost } from '../providerSettings';

describe('normalizeOllamaHost', () => {
  it('adds an http:// scheme when the user omits it', () => {
    expect(normalizeOllamaHost('localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeOllamaHost('127.0.0.1:11434')).toBe('http://127.0.0.1:11434');
  });

  it('keeps an explicit http/https scheme', () => {
    expect(normalizeOllamaHost('http://localhost:11434')).toBe('http://localhost:11434');
    expect(normalizeOllamaHost('https://ollama.local')).toBe('https://ollama.local');
  });

  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeOllamaHost('  http://localhost:11434/  ')).toBe('http://localhost:11434');
    expect(normalizeOllamaHost('localhost:11434///')).toBe('http://localhost:11434');
  });

  it('falls back to the default when empty', () => {
    expect(normalizeOllamaHost('')).toBe('http://localhost:11434');
    expect(normalizeOllamaHost('   ')).toBe('http://localhost:11434');
  });
});
