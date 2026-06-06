// Prompt Versioning — SHA-256 hashes of every prompt template for reproducibility.
// Every manuscript/response links to the prompt hashes used to generate it,
// creating an audit trail for compliance and regression tracking.

const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface PromptVersion {
  hash: string;
  template: string;
  role: 'system' | 'user';
  registeredAt: string;
}

const registry = new Map<string, PromptVersion>();

/**
 * Register a prompt template and return its deterministic SHA-256 hash.
 * If the same template was registered before, the existing hash is returned.
 */
export async function registerPrompt(
  template: string,
  role: 'system' | 'user' = 'system',
): Promise<string> {
  const hash = await sha256Hex(template);
  if (!registry.has(hash)) {
    registry.set(hash, {
      hash,
      template,
      role,
      registeredAt: new Date().toISOString(),
    });
  }
  return hash;
}

/**
 * Look up a prompt version by its hash.
 */
export function getPromptVersion(hash: string): PromptVersion | undefined {
  return registry.get(hash);
}

/**
 * Return all registered prompt versions.
 */
export function allPromptVersions(): PromptVersion[] {
  return Array.from(registry.values());
}

/**
 * Hash an already-materialised message (after variable substitution) for
 * the exact audit trail. This is distinct from template hashing because
 * the same template can produce different concrete prompts.
 */
export async function hashConcretePrompt(text: string): Promise<string> {
  return sha256Hex(text);
}
