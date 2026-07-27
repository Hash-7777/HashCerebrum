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
// without macOS Keychain prompting on every read. That convenience is the
// whole trade: the keys are NOT encrypted at rest, and the only thing keeping
// another local process out is the OS file permissions on the app's data
// directory. Describe it that way everywhere — never as "the OS keychain".
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
  secrets: {
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
    append: (_category, _subject, _action, _payload) =>
      // audit_log_append removed from renderer surface — all audit entries
      // originate from guarded Rust commands only.
      Promise.reject(new Error('audit_log_append is not available from renderer')),
    read: (options) =>
      options
        ? invoke<AuditEntry[]>('audit_log_read_page', {
            offset: options.offset ?? 0,
            limit: options.limit ?? 100,
          })
        : invoke<AuditEntry[]>('audit_log_read'),
    count: () => invoke<number>('audit_log_count'),
    verify: () => invoke<number | null>('audit_log_verify'),
    reset: () => invoke<void>('audit_log_reset'),
  },

  medical: {
    pubmed: mkMedical('pubmed', 'pubmed_search'),
    europepmc: mkMedical('europepmc', 'europepmc_fetch'),
    openalex: mkMedical('openalex', 'openalex_query'),
    semantic_scholar: mkMedical('semantic_scholar', 'semantic_scholar_search'),
    gwas_catalog: mkMedical('gwas_catalog', 'gwas_catalog_search'),
    clinvar: mkMedical('clinvar', 'clinvar_search'),
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
    crossref_lookup: (doi) => invoke('crossref_lookup', { doi }),
    europepmcFulltext: (source, id) => invoke<string>('europepmc_fulltext', { source, id }),
  },

  pdf: {
    // Pass bytes as-is — Tauri v2 IPC serialises Uint8Array efficiently;
    // Array.from() would create a redundant number[] copy (~2× memory).
    extractTextBytes: (filename, bytes) =>
      invoke<string>('pdf_extract_text_bytes', { filename, bytes }),
    extractPagesBytes: (filename, bytes) =>
      invoke<string[]>('pdf_extract_pages_bytes', { filename, bytes }),
    fetchOpenAccessPdf: (url) => invoke<string>('fetch_open_access_pdf', { url }),
  },

  manuscript: {
    renderPdf: async (manuscript, references, meta) => {
      const bytes = await invoke<number[]>('render_manuscript_pdf', { manuscript, references, meta });
      return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
    },
  },

  files: {
    // Native save: pick a destination with the OS save dialog, then write the
    // bytes from Rust. WKWebView can't save blob downloads, so this is the
    // reliable desktop export path.
    save: async (filename, blob) => {
      try {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const path = await save({ defaultPath: filename });
        if (!path) return false;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await invoke('write_file_bytes', { path, bytes });
        return true;
      } catch (err) {
        // Contain any dialog / write failure so a save error can never bubble
        // up as an unhandled rejection.
        console.error('[files.save] failed:', err instanceof Error ? err.message : String(err));
        return false;
      }
    },
  },

  cache: {
    stats: () => invoke<CacheStats>('cache_stats'),
    clear: () => invoke<number>('cache_clear'),
    clearExpired: () => invoke<number>('cache_clear_expired'),
  },

  usageLog: {
    append: (record) => invoke<void>('usage_log_append', { record }),
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
    httpGet: (provider, url, headers, _signal) =>
      invoke<{ status: number; body: string }>('llm_http_get', { provider, url, headers }),
    httpPost: (provider, url, headers, body, _signal) =>
      invoke<{ status: number; body: string }>('llm_http_post', { provider, url, headers, body }),
    chatStream: async (provider, url, headers, body, onLine, signal) => {
      if (signal?.aborted) throw new Error('Stream aborted');
      const streamId = crypto.randomUUID();
      const doAbort = () => { void invoke('llm_chat_stream_abort', { streamId }); };
      signal?.addEventListener('abort', doAbort);

      const channel = new Channel<{ kind: 'line'; text: string } | { kind: 'error'; message: string }>();
      let streamError: string | null = null;
      channel.onmessage = (event) => {
        if (signal?.aborted) return;
        if (event.kind === 'line') onLine(event.text);
        else streamError = event.message;
      };
      try {
        await invoke('llm_chat_stream', { provider, url, headers, body, streamId, onEvent: channel });
      } finally {
        signal?.removeEventListener('abort', doAbort);
        channel.onmessage = () => {};
      }
      if (streamError) throw new Error(streamError);
    },
  },

  app: {
    relaunch: () => invoke<void>('app_relaunch'),
  },

  openExternal: (url: string) => invoke<void>('plugin:opener|open_url', { url }),

  compliance: {
    purgeProjectData: (projectId: string) =>
      invoke<Record<string, number>>('purge_project_data', { projectId }),
  },

  env: {
    isTauri: true,
    platform: detectPlatform(),
  },
};
