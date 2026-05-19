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
  source: 'pubmed' | 'europepmc' | 'openalex' | 'ctgov' | 'openfda' | 'rxnorm';
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

export interface Platform {
  // Keychain — API keys never leave Rust
  keychain: {
    store(key: string, value: string): Promise<void>;
    retrieve(key: string): Promise<string | null>;
    delete(key: string): Promise<void>;
  };

  // Audit — hash-chained log
  audit: {
    append(category: string, subject: string, action: string, payload: unknown): Promise<AuditEntry>;
    read(): Promise<AuditEntry[]>;
    verify(): Promise<number | null>; // returns broken seq or null if intact
  };

  // Medical sources
  medical: {
    pubmed(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    europepmc(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    openalex(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    ctgov(q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    openfda(endpoint: string, q: MedicalSourceQuery): Promise<MedicalSourceResult>;
    rxnorm(drug: string): Promise<MedicalSourceResult>;
  };

  // PDF extraction
  pdf: {
    extractText(path: string): Promise<string>;
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
