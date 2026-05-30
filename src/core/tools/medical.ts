import { platform, type MedicalSourceQuery } from '@platform/index';
import { tools } from './ToolRegistry';

const sourceQuerySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1 },
    maxResults: { type: 'integer', minimum: 1, maximum: 40 },
  },
};

const openFdaSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    endpoint: {
      type: 'string',
      enum: ['drug/event', 'drug/label', 'drug/drugsfda', 'device/event'],
      default: 'drug/event',
    },
    query: { type: 'string', minLength: 1 },
    maxResults: { type: 'integer', minimum: 1, maximum: 40 },
  },
};

const rxNormSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['drug'],
  properties: {
    drug: { type: 'string', minLength: 1 },
  },
};

function cleanQuery(args: unknown): MedicalSourceQuery {
  const raw = (args ?? {}) as { query?: unknown; maxResults?: unknown };
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  if (!query) throw new Error('query is required');
  const parsedMax = Number(raw.maxResults);
  return {
    query,
    // Deeper default pull so a single specialist sweep returns a substantial,
    // citable evidence base rather than a thin top-handful.
    maxResults: Number.isFinite(parsedMax) ? Math.min(40, Math.max(1, Math.round(parsedMax))) : 15,
  };
}

function cleanDrug(args: unknown): string {
  const drug = typeof (args as { drug?: unknown })?.drug === 'string' ? (args as { drug: string }).drug.trim() : '';
  if (!drug) throw new Error('drug is required');
  return drug;
}

export function registerMedicalTools() {
  if (tools.get('pubmed_search')) return;

  tools.register({
    name: 'pubmed_search',
    description: 'Search PubMed biomedical literature through the Rust network guard.',
    parameters: sourceQuerySchema,
    execute: (args) => platform().medical.pubmed(cleanQuery(args)),
  });

  tools.register({
    name: 'europepmc_fetch',
    description: 'Search Europe PMC biomedical literature through the Rust network guard.',
    parameters: sourceQuerySchema,
    execute: (args) => platform().medical.europepmc(cleanQuery(args)),
  });

  tools.register({
    name: 'openalex_query',
    description: 'Search OpenAlex scholarly works through the Rust network guard.',
    parameters: sourceQuerySchema,
    execute: (args) => platform().medical.openalex(cleanQuery(args)),
  });

  tools.register({
    name: 'ctgov_search',
    description: 'Search ClinicalTrials.gov studies through the Rust network guard.',
    parameters: sourceQuerySchema,
    execute: (args) => platform().medical.ctgov(cleanQuery(args)),
  });

  tools.register({
    name: 'openfda_query',
    description: 'Search OpenFDA drug or device records through the Rust network guard.',
    parameters: openFdaSchema,
    execute: (args) => {
      const raw = (args ?? {}) as { endpoint?: unknown };
      const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint : 'drug/event';
      return platform().medical.openfda(endpoint, cleanQuery(args));
    },
  });

  tools.register({
    name: 'rxnorm_lookup',
    description: 'Resolve a drug name in RxNorm through the Rust network guard.',
    parameters: rxNormSchema,
    execute: (args) => platform().medical.rxnorm(cleanDrug(args)),
  });
}
