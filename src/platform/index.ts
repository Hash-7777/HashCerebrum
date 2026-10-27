// Platform abstraction — UI/agents NEVER call Tauri directly. They call
// through this interface so:
//   1. Browser dev (vite dev without Tauri shell) works via a mock impl
//   2. The renderer cannot accidentally widen its capability surface —
//      every IPC call site is grep-able from src/platform/tauri/*
//   3. Tests can swap a fake platform in
//
// To add a new IPC call: extend Platform here, implement in tauri/, mock in browser/.

import type { AuditEntry } from '@core/bus/events';

export interface MedicalSourceQuery {
  query: string;
  maxResults?: number;
}

export interface EvidenceItem {
  source: 'pubmed' | 'europepmc' | 'openalex' | 'ctgov' | 'openfda' | 'rxnorm' | 'semantic_scholar' | 'gwas_catalog' | 'clinvar' | 'library';
  title: string;
  year?: number | string | null;
  authors: string[];
  identifiers: Record<string, string>;
  volume?: string | null;
  issue?: string | null;
  pages?: string | null;
  url?: string | null;
  snippet?: string | null;
  fetchedAt: string;
  provenanceHash: string;
}

export interface MedicalSourceResult {
  source: EvidenceItem['source'];
  results: EvidenceItem[];
  fetchedAt: string;
  provenanceHash: string;
}

export interface CrossrefMeta {
  doi: string;
  title: string;
  containerTitle?: string | null;
  publishedDate?: string | null;
  citationCount?: number | null;
  referenceCount?: number | null;
  authors: string[];
  url: string;
}

export interface CacheHostStat {
  host: string;
  rows: number;
  bytes: number;
}

export interface CacheStats {
  rows: number;
  bytes: number;
  hosts: CacheHostStat[];
}

// One measured token-usage record, appended to usage.jsonl for the HashMeter
// ecosystem. Snake_case keys ARE the on-disk contract shared with HashCortx and
// read by HashMeterAi — never carries any message content.
export interface UsageLogRecord {
  ts: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read?: number;
  cache_write?: number;
  cost?: number;
}

/** The three licence documents a build carries: the app's own licence, the
 *  dependency inventory, and the third-party notices. */
export type LicenseDocumentId = 'project' | 'inventory' | 'notices';

export interface Platform {
  // Secrets — provider API keys. These live in the renderer's own storage
  // inside the app's private data directory, NOT in the OS keychain. Nothing
  // here is encrypted at rest; the protection is the OS file permissions on
  // that directory. Say so plainly wherever this is described to a user.
  secrets: {
    store(key: string, value: string): Promise<void>;
    retrieve(key: string): Promise<string | null>;
    delete(key: string): Promise<void>;
  };

  // Audit — hash-chained log
  audit: {
    append(category: string, subject: string, action: string, payload: unknown): Promise<AuditEntry>;
    read(options?: { offset?: number; limit?: number }): Promise<AuditEntry[]>;
    count(): Promise<number>;
    verify(): Promise<number | null>; // returns broken seq or null if intact
    reset(): Promise<void>; // clear the log to a fresh chain
  };

  // Medical sources
  medical: {
    pubmed(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    europepmc(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    openalex(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    semantic_scholar(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    /** GWAS Catalog — curated gene/variant ↔ trait associations with OR/CI/p. */
    gwas_catalog(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    /** ClinVar — variant clinical significance and linked conditions. */
    clinvar(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    ctgov(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    openfda(endpoint: string, q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    rxnorm(drug: string): Promise<MedicalSourceResult>;
    crossref_lookup(doi: string): Promise<CrossrefMeta>;
    /** Open-access full text (plain text) for an Europe PMC article, by source
     *  code ("PMC"/"MED") + id. Rejects when no open-access full text exists —
     *  callers fall back to the abstract. */
    europepmcFulltext(source: string, id: string): Promise<string>;
  };

  // PDF extraction (bytes-based only — path-based command removed)
  pdf: {
    extractTextBytes(filename: string, bytes: Uint8Array): Promise<string>;
    /** One string per page, in page order — for page-accurate citations. */
    extractPagesBytes(filename: string, bytes: Uint8Array): Promise<string[]>;
    /** Download an open-access PDF by URL and extract its text. */
    fetchOpenAccessPdf(url: string): Promise<string>;
  };

  // Manuscript typesetting — a structured manuscript rendered to a PDF by
  // the embedded Typst engine. Desktop-only; browser dev rejects so the
  // caller falls back to the jsPDF renderer.
  manuscript: {
    renderPdf(
      manuscript: unknown,
      references: { marker: string; text: string; url?: string }[],
      meta: string,
    ): Promise<Blob>;
  };

  // SQLite cache controls — surfaced in Settings so the user can see
  // per-host row/byte counts and clear expired or all rows.
  cache: {
    stats(): Promise<CacheStats>;
    clear(): Promise<number>;
    clearExpired(): Promise<number>;
  };

  // App storage — durable UI data that is not secret. Tauri uses the
  // store plugin; browser dev uses localStorage through the mock.
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Token-usage log — one measured record per model response, appended to
  // usage.jsonl in the app data dir so HashMeterAi can report HashCerebrum
  // usage accurately. Best-effort: callers must not let a failure break a run.
  usageLog: {
    append(record: UsageLogRecord): Promise<void>;
  };

  // LLM provider HTTP — proxied through Rust so the guard, rate limiter,
  // and audit log cover provider calls. The renderer supplies the auth
  // headers per call; Rust never logs them. chatStream resolves once the
  // stream ends and rejects if the provider returned an error.
  llm: {
    httpGet(
      provider: string,
      url: string,
      headers: Record<string, string>,
      signal?: AbortSignal | undefined,
    ): Promise<{ status: number; body: string }>;
    httpPost(
      provider: string,
      url: string,
      headers: Record<string, string>,
      body: string,
      signal?: AbortSignal | undefined,
    ): Promise<{ status: number; body: string }>;
    chatStream(
      provider: string,
      url: string,
      headers: Record<string, string>,
      body: string,
      onLine: (line: string) => void,
      signal?: AbortSignal | undefined,
    ): Promise<void>;
  };

  // App lifecycle
  app: {
    relaunch(): Promise<void>;
  };

  // Open a URL in the system's default browser — the desktop build hands off to
  // the OS via the opener plugin (no in-app navigation); the browser opens a tab.
  openExternal(url: string): Promise<void>;

  // Compliance
  compliance: {
    purgeProjectData(projectId: string): Promise<Record<string, number>>;
  };

  // Licence documents — the attribution bundle that ships in the app's
  // resource folder, read on demand for the in-app Licenses view. The
  // document is named by this union, never by path.
  licenses: {
    read(document: LicenseDocumentId): Promise<string>;
  };

  // File saving. WKWebView ignores `<a download>` for blob URLs, so the desktop
  // path goes through a native save dialog + write; the browser keeps the
  // anchor download. Resolves true when a file was written, false if cancelled.
  files: {
    save(filename: string, blob: Blob): Promise<boolean>;
  };

  // Environment
  env: {
    isTauri: boolean;
    platform: 'darwin' | 'win32' | 'linux' | 'browser';
  };
}

let _platform: Platform | null = null;

export function setPlatform(p: Platform) {
  _platform = p;
}

export function platform(): Platform {
  if (!_platform) throw new Error('Platform not initialized — call setPlatform() in main.tsx');
  return _platform;
}
