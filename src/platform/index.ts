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
  source: 'pubmed' | 'europepmc' | 'openalex' | 'ctgov' | 'openfda' | 'rxnorm' | 'semantic_scholar' | 'library';
  title: string;
  year?: number | string | null;
  authors: string[];
  identifiers: Record<string, string>;
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

export interface Platform {
  // Keychain — secret values are stored in the OS keychain at rest.
  keychain: {
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
  };

  // Medical sources
  medical: {
    pubmed(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    europepmc(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    openalex(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    semantic_scholar(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    ctgov(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    openfda(endpoint: string, q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    rxnorm(drug: string): Promise<MedicalSourceResult>;
    crossref_lookup(doi: string): Promise<CrossrefMeta>;
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
      references: { marker: string; text: string }[],
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

  // Compliance
  compliance: {
    purgeProjectData(projectId: string): Promise<Record<string, number>>;
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
