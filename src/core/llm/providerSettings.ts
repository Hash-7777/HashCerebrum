const OLLAMA_HOST_KEY = 'hc.ollamaHost';
const PRIVACY_LOCAL_KEY = 'hc.privacyLocalOnly';

export function getOllamaHost(): string {
  return localStorage.getItem(OLLAMA_HOST_KEY) || 'http://localhost:11434';
}

export function setOllamaHost(host: string) {
  const normalized = host.trim().replace(/\/+$/, '') || 'http://localhost:11434';
  localStorage.setItem(OLLAMA_HOST_KEY, normalized);
}

export function getPrivacyLocalOnly(): boolean {
  return localStorage.getItem(PRIVACY_LOCAL_KEY) === 'true';
}

export function setPrivacyLocalOnly(value: boolean) {
  localStorage.setItem(PRIVACY_LOCAL_KEY, String(value));
}
