const OLLAMA_HOST_KEY = 'hc.ollamaHost';
const PRIVACY_LOCAL_KEY = 'hc.privacyLocalOnly';
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';

// Normalise a user-entered Ollama host: trim, drop trailing slashes, and add an
// http:// scheme when omitted — "localhost:11434" without a scheme is not a
// valid request URL and is a common reason the connection silently fails.
export function normalizeOllamaHost(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_OLLAMA_HOST;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function getOllamaHost(): string {
  return localStorage.getItem(OLLAMA_HOST_KEY) || DEFAULT_OLLAMA_HOST;
}

export function setOllamaHost(host: string) {
  localStorage.setItem(OLLAMA_HOST_KEY, normalizeOllamaHost(host));
}

export function getPrivacyLocalOnly(): boolean {
  return localStorage.getItem(PRIVACY_LOCAL_KEY) === 'true';
}

export function setPrivacyLocalOnly(value: boolean) {
  localStorage.setItem(PRIVACY_LOCAL_KEY, String(value));
}
