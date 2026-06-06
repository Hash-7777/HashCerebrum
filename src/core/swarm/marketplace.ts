// Agent Swarm Marketplace — manifest format and local registry loader.
// Defines hc.agent.v1 manifest for community-contributable specialist agents.

export interface AgentManifest {
  version: 'hc.agent.v1';
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  tools: string[];
  systemPrompt: string;
  compliance: {
    humanInTheLoop: boolean;
    evidenceRequired: boolean;
    maxTokens: number;
  };
  schema: object; // JSON schema for validation
}

const registry = new Map<string, AgentManifest>();

/**
 * Validate a manifest against the hc.agent.v1 schema.
 */
export function validateManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'] };
  }
  const m = manifest as Record<string, unknown>;
  if (m.version !== 'hc.agent.v1') errors.push('version must be "hc.agent.v1"');
  if (!m.id || typeof m.id !== 'string') errors.push('id is required');
  if (!m.name || typeof m.name !== 'string') errors.push('name is required');
  if (!m.systemPrompt || typeof m.systemPrompt !== 'string') errors.push('systemPrompt is required');
  if (!Array.isArray(m.tools)) errors.push('tools must be an array');
  if (!m.compliance || typeof m.compliance !== 'object') errors.push('compliance is required');
  return { valid: errors.length === 0, errors };
}

/**
 * Register a manifest in the local marketplace.
 */
export function registerManifest(manifest: AgentManifest): boolean {
  const validation = validateManifest(manifest);
  if (!validation.valid) return false;
  registry.set(manifest.id, manifest);
  return true;
}

/**
 * Load all .agent.json files from a directory (mock for browser; real impl
 * would use Tauri fs API).
 */
export async function loadRegistryFromDirectory(): Promise<number> {
  // Browser dev: start with built-in examples
  const builtIn: AgentManifest[] = [
    {
      version: 'hc.agent.v1',
      id: 'onco-reviewer',
      name: 'Oncology Evidence Reviewer',
      description: 'Critically appraises oncology trial methodology and endpoints.',
      capabilities: ['trial_critique', 'endpoint_analysis', 'survival_review'],
      tools: ['pubmed_search', 'ctgov_search', 'semantic_scholar_search'],
      systemPrompt:
        'You are an oncology evidence reviewer. Focus on trial design, endpoint validity, and biomarker relevance. Always cite sources.',
      compliance: { humanInTheLoop: true, evidenceRequired: true, maxTokens: 4000 },
      schema: {},
    },
  ];
  let count = 0;
  for (const m of builtIn) {
    if (registerManifest(m)) count++;
  }
  return count;
}

export function listAgents(): AgentManifest[] {
  return Array.from(registry.values());
}

export function getAgent(id: string): AgentManifest | undefined {
  return registry.get(id);
}
