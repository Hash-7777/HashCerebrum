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
  semantic_scholar: 'https://www.semanticscholar.org/',
  library: '',
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
const devKeychainKey = (key: string) => `hc.dev.keychain.${key}`;
const devKeychain = new Map<string, string>();

function browserKeychainSet(key: string, value: string) {
  devKeychain.set(key, value);
  try {
    localStorage.setItem(devKeychainKey(key), value);
  } catch {
    /* map fallback is enough for browser dev */
  }
}

function browserKeychainGet(key: string): string | null {
  try {
    return localStorage.getItem(devKeychainKey(key)) ?? devKeychain.get(key) ?? null;
  } catch {
    return devKeychain.get(key) ?? null;
  }
}

function browserKeychainDelete(key: string) {
  devKeychain.delete(key);
  try {
    localStorage.removeItem(devKeychainKey(key));
  } catch {
    /* ignore */
  }
}

export const browserPlatform: Platform = {
  keychain: {
    store: async (key, value) => {
      if (value) browserKeychainSet(key, value);
      else browserKeychainDelete(key);
    },
    retrieve: async (key) => browserKeychainGet(key),
    delete: async (key) => {
      browserKeychainDelete(key);
    },
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
    semantic_scholar: async () => mocked('semantic_scholar', 'Mock Semantic Scholar result'),
    crossref_lookup: async (doi: string) => ({
      doi,
      title: 'Mock Crossref title',
      containerTitle: 'Mock Journal',
      publishedDate: '2025-01-01',
      citationCount: 42,
      referenceCount: 30,
      authors: ['Browser mock'],
      url: `https://doi.org/${doi}`,
    }),
  },
  pdf: {
    extractTextBytes: async () => {
      throw new Error('PDF text extraction requires the desktop app');
    },
    extractPagesBytes: async () => {
      throw new Error('PDF text extraction requires the desktop app');
    },
    fetchOpenAccessPdf: async () => {
      throw new Error('Open-access PDF fetching requires the desktop app');
    },
  },
  manuscript: {
    renderPdf: async () => {
      throw new Error('Typst manuscript rendering needs the desktop app');
    },
  },
  files: {
    // Browser dev: the classic anchor download works here.
    save: async (filename: string, blob: Blob) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    },
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
  llm: {
    // Browser dev has no Rust shell; a direct fetch will usually be
    // blocked by provider CORS, which the caller already handles as a
    // provider error. The Tauri shell is the supported path.
    httpGet: async (_provider, url, headers, signal) => {
      const response = await fetch(url, { headers, cache: 'no-store', referrerPolicy: 'no-referrer', ...(signal ? { signal } : {}) });
      return { status: response.status, body: await response.text() };
    },
    httpPost: async (_provider, url, headers, body, signal) => {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(signal ? { signal } : {}),
      });
      return { status: response.status, body: await response.text() };
    },
    chatStream: async (_provider, url, headers, body, onLine, signal) => {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
      }
      if (!response.body) throw new Error('Streaming response has no body');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl = buffer.indexOf('\n');
          while (nl !== -1) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (line) onLine(line);
            nl = buffer.indexOf('\n');
          }
        }
        if (buffer.trim()) onLine(buffer.trim());
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        throw err;
      }
    },
  },
  app: {
    relaunch: async () => { window.location.reload(); },
  },

  env: {
    isTauri: false,
    platform: 'browser',
  },
};
