const OLLAMA_HOST_KEY = 'hc.ollamaHost';
const CLOUDFLARE_ACCOUNT_KEY = 'hc.cloudflareAccount';
const MOONSHOT_HOST_KEY = 'hc.moonshotHost';
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

// Cloudflare Workers AI puts the account id in the address, so it is needed
// alongside the key. It is not a secret the way a key is — it identifies an
// account, it does not authorise anything — so it lives here with the other
// settings. Only thirty-two hex characters are ever stored, which is what
// makes it safe to drop into a URL path.
export function normalizeCloudflareAccount(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(trimmed) ? trimmed : '';
}

export function getCloudflareAccount(): string {
  return normalizeCloudflareAccount(localStorage.getItem(CLOUDFLARE_ACCOUNT_KEY) ?? '');
}

export function setCloudflareAccount(value: string) {
  const account = normalizeCloudflareAccount(value);
  if (account) localStorage.setItem(CLOUDFLARE_ACCOUNT_KEY, account);
  else localStorage.removeItem(CLOUDFLARE_ACCOUNT_KEY);
}

// Moonshot runs two platforms with separate account systems, each at its own
// address. A key minted on one is refused by the other, which reads exactly
// like a wrong key — so the model list tries both and the one that answered is
// remembered here, and every later request goes straight to it.
export const MOONSHOT_HOSTS = ['https://api.moonshot.ai', 'https://api.moonshot.cn'] as const;

export function getMoonshotHost(): string {
  const saved = localStorage.getItem(MOONSHOT_HOST_KEY) ?? '';
  return (MOONSHOT_HOSTS as readonly string[]).includes(saved) ? saved : MOONSHOT_HOSTS[0];
}

export function setMoonshotHost(host: string) {
  if ((MOONSHOT_HOSTS as readonly string[]).includes(host)) localStorage.setItem(MOONSHOT_HOST_KEY, host);
}
