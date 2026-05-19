// SHA-256 via Web Crypto, hex-encoded. Used for content-addressable IDs
// (citation provenance, message IDs, RAG chunks).

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const source = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const data = new Uint8Array(source);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
