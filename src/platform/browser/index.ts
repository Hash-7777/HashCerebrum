// Browser mock — lets `vite dev` run without the Tauri shell so we can
// iterate on UI without rebuilding Rust. Returns deterministic fake data.

import type { Platform } from '../index';

const empty = (source: any) => ({
  source,
  results: [],
  fetchedAt: new Date().toISOString(),
  provenanceHash: 'mock',
});

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
    verify: async () => null,
  },
  medical: {
    pubmed: async () => empty('pubmed'),
    europepmc: async () => empty('europepmc'),
    openalex: async () => empty('openalex'),
    ctgov: async () => empty('ctgov'),
    openfda: async () => empty('openfda'),
    rxnorm: async () => empty('rxnorm'),
  },
  pdf: {
    extractText: async () => '',
  },
  env: {
    isTauri: false,
    platform: 'browser',
  },
};
