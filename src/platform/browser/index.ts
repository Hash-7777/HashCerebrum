// Browser mock — lets `vite dev` run without the Tauri shell so we can
// iterate on UI without rebuilding Rust. Returns deterministic fake data.

import type { EvidenceItem, Platform } from '../index';

const sourceUrl: Record<EvidenceItem['source'], string> = {
  pubmed: 'https://pubmed.ncbi.nlm.nih.gov/',
  europepmc: 'https://europepmc.org/',
  openalex: 'https://openalex.org/',
  ctgov: 'https://clinicaltrials.gov/',
  openfda: 'https://open.fda.gov/',
  rxnorm: 'https://rxnav.nlm.nih.gov/',
};

const sample = (source: EvidenceItem['source'], title: string): EvidenceItem => ({
  source,
  title,
  year: 2025,
  authors: ['Browser mock'],
  identifiers: { mock: `${source}-demo` },
  url: sourceUrl[source],
  snippet: 'Deterministic browser-mode fixture. Run in the Tauri shell to fetch live medical sources through the Rust guard.',
  fetchedAt: new Date().toISOString(),
  provenanceHash: `mock-${source}`,
});

const mocked = (source: EvidenceItem['source'], title: string) => ({
  source,
  results: [sample(source, title)],
  fetchedAt: new Date().toISOString(),
  provenanceHash: 'mock',
});

const storageKey = (key: string) => `hc.storage.${key}`;

export const browserPlatform: Platform = {
  keychain: {
    store: async () => {},
    retrieve: async () => null,
    delete: async () => {},
  },
  audit: {
    append: async (category, subject, action) => ({
      seq: 0,
      ts: new Date().toISOString(),
      category,
      subject,
      action,
      data_hash: 'mock',
      prev_hash: 'mock',
      entry_hash: 'mock',
    }),
    read: async () => [],
    count: async () => 0,
    verify: async () => null,
  },
  medical: {
    pubmed: async () => mocked('pubmed', 'Mock PubMed literature result'),
    europepmc: async () => mocked('europepmc', 'Mock Europe PMC literature result'),
    openalex: async () => mocked('openalex', 'Mock OpenAlex knowledge graph result'),
    ctgov: async () => mocked('ctgov', 'Mock ClinicalTrials.gov study result'),
    openfda: async () => mocked('openfda', 'Mock OpenFDA safety signal result'),
    rxnorm: async () => mocked('rxnorm', 'Mock RxNorm concept result'),
  },
  pdf: {
    extractText: async () => '',
  },
  cache: {
    stats: async () => ({ rows: 0, bytes: 0, hosts: [] }),
    clear: async () => 0,
    clearExpired: async () => 0,
  },
  storage: {
    get: async <T,>(key: string) => {
      const raw = localStorage.getItem(storageKey(key));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set: async <T,>(key: string, value: T) => {
      localStorage.setItem(storageKey(key), JSON.stringify(value));
    },
    delete: async (key: string) => {
      localStorage.removeItem(storageKey(key));
    },
  },
  env: {
    isTauri: false,
    platform: 'browser',
  },
};
