const BEARER_SECRET = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const API_KEY_ASSIGNMENT = /(api[_ -]?key["':=\s]+)[A-Za-z0-9._~+/=-]+/gi;
const COMMON_PROVIDER_KEY = /\b(sk-[A-Za-z0-9_-]{12,}|sk-or-v1-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9_-]{12,}|AIza[0-9A-Za-z_-]{12,})\b/g;

export function secretValuesFromHeaders(headers: Record<string, string>): string[] {
  const secrets: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (!value || !/authorization|api[-_]?key|x-goog-api-key/i.test(name)) continue;
    secrets.push(value);
    const bearer = value.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) secrets.push(bearer);
  }
  return secrets;
}

export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    clean = clean.split(secret).join('[redacted]');
  }
  return clean
    .replace(BEARER_SECRET, 'Bearer [redacted]')
    .replace(API_KEY_ASSIGNMENT, '$1[redacted]')
    .replace(COMMON_PROVIDER_KEY, '[redacted]');
}
