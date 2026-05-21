import { Channel, invoke } from '@tauri-apps/api/core';
import { Store } from '@tauri-apps/plugin-store';
import type { CacheStats, EvidenceItem, Platform, MedicalSourceQuery, MedicalSourceResult } from '../index';
import type { AuditEntry } from '@core/bus/events';

const detectPlatform = (): Platform['env']['platform'] => {
  if (typeof navigator === 'undefined') return 'browser';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'darwin';
  if (ua.includes('win')) return 'win32';
  return 'linux';
};

const mkMedical =
  (source: MedicalSourceResult['source'], cmd: string) =>
  async (q: MedicalSourceQuery): Promise<MedicalSourceResult> => {
    const results = await invoke<EvidenceItem[]>(cmd, {
      query: q.query,
      maxResults: q.maxResults ?? 25,
    });
    const first = results[0];
    return {
      source,
      results,
      fetchedAt: first?.fetchedAt ?? new Date().toISOString(),
      provenanceHash: first?.provenanceHash ?? '',
    };
  };

let appStore: Promise<Store> | null = null;

function store() {
  appStore ??= Store.load('hashcerebrum.store.json');
  return appStore;
}

// Provider API keys live in renderer localStorage as one JSON bundle.
//
// Tauri's WebKit data dir is keyed by the bundle identifier, not the binary's
// code signature, so the bundle survives every rebuild and signed-DMG update
// without macOS Keychain prompting on every read. The Rust `keychain_*`
// commands remain registered for future migration tooling but are no longer
// hit on the hot path.
const LS_BUNDLE_KEY = 'hc_api_bundle_v2';

function getBundle(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_BUNDLE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveBundle(data: Record<string, string>): void {
  try {
    localStorage.setItem(LS_BUNDLE_KEY, JSON.stringify(data));
  } catch {
    /* renderer has no safer fallback than localStorage here */
  }
}

export const tauriPlatform: Platform = {
  keychain: {
    store: async (key, value) => {
      const data = getBundle();
      if (value) data[key] = value;
      else delete data[key];
      saveBundle(data);
    },
    retrieve: async (key) => getBundle()[key] ?? null,
    delete: async (key) => {
      const data = getBundle();
      delete data[key];
      saveBundle(data);
    },
  },

  audit: {
    append: (category, subject, action, payload) =>
      invoke<AuditEntry>('audit_log_append', { category, subject, action, payload }),
    read: (options) =>
      options
        ? invoke<AuditEntry[]>('audit_log_read_page', {
            offset: options.offset ?? 0,
            limit: options.limit ?? 100,
          })
        : invoke<AuditEntry[]>('audit_log_read'),
    count: () => invoke<number>('audit_log_count'),
    verify: () => invoke<number | null>('audit_log_verify'),
  },

  medical: {
    pubmed: mkMedical('pubmed', 'pubmed_search'),
    europepmc: mkMedical('europepmc', 'europepmc_fetch'),
    openalex: mkMedical('openalex', 'openalex_query'),
    ctgov: mkMedical('ctgov', 'ctgov_search'),
    openfda: async (endpoint, q) => {
      const results = await invoke<EvidenceItem[]>('openfda_query', {
        endpoint,
        query: q.query,
        maxResults: q.maxResults ?? 25,
      });
      const first = results[0];
      return {
        source: 'openfda',
        results,
        fetchedAt: first?.fetchedAt ?? new Date().toISOString(),
        provenanceHash: first?.provenanceHash ?? '',
      };
    },
    rxnorm: async (drug) => {
      const results = await invoke<EvidenceItem[]>('rxnorm_lookup', { drug });
      const first = results[0];
      return {
        source: 'rxnorm',
        results,
        fetchedAt: first?.fetchedAt ?? new Date().toISOString(),
        provenanceHash: first?.provenanceHash ?? '',
      };
    },
  },

  pdf: {
    extractText: (path) => invoke<string>('pdf_extract_text', { path }),
  },

  manuscript: {
    renderPdf: async (manuscript, references, meta) => {
      const bytes = await invoke<number[]>('render_manuscript_pdf', { manuscript, references, meta });
      return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    },
  },

  cache: {
    stats: () => invoke<CacheStats>('cache_stats'),
    clear: () => invoke<number>('cache_clear'),
    clearExpired: () => invoke<number>('cache_clear_expired'),
  },

  storage: {
    get: async <T,>(key: string) => {
      const s = await store();
      return (await s.get<T>(key)) ?? null;
    },
    set: async <T,>(key: string, value: T) => {
      const s = await store();
      await s.set(key, value);
      await s.save();
    },
    delete: async (key: string) => {
      const s = await store();
      await s.delete(key);
      await s.save();
    },
  },

  llm: {
    httpGet: (provider, url, headers) =>
      invoke<{ status: number; body: string }>('llm_http_get', { provider, url, headers }),
    httpPost: (provider, url, headers, body) =>
      invoke<{ status: number; body: string }>('llm_http_post', { provider, url, headers, body }),
    chatStream: async (provider, url, headers, body, onLine) => {
      const channel = new Channel<{ kind: 'line'; text: string } | { kind: 'error'; message: string }>();
      let streamError: string | null = null;
      channel.onmessage = (event) => {
        if (event.kind === 'line') onLine(event.text);
        else streamError = event.message;
      };
      await invoke('llm_chat_stream', { provider, url, headers, body, onEvent: channel });
      if (streamError) throw new Error(streamError);
    },
  },

  env: {
    isTauri: true,
    platform: detectPlatform(),
  },
};
