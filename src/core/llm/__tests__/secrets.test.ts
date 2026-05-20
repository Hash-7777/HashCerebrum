import { describe, expect, it } from 'vitest';
import { redactSecrets, secretValuesFromHeaders } from '../secrets';

describe('secret redaction', () => {
  it('redacts provider keys from HTTP error text', () => {
    const key = 'provider-secret-value-that-should-not-leak';
    const text = `HTTP 401 bearer=Bearer ${key} api_key="${key}" raw ${key}`;

    const redacted = redactSecrets(text, [key]);

    expect(redacted).not.toContain(key);
    expect(redacted).toContain('[redacted]');
  });

  it('extracts secrets from auth headers for downstream redaction', () => {
    const secrets = secretValuesFromHeaders({
      Authorization: 'Bearer provider-secret-header-value',
      'x-goog-api-key': 'google-provider-secret-value',
      Accept: 'application/json',
    });

    expect(secrets).toContain('Bearer provider-secret-header-value');
    expect(secrets).toContain('provider-secret-header-value');
    expect(secrets).toContain('google-provider-secret-value');
  });
});
