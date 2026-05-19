import { invoke } from '@tauri-apps/api/core';
import type { Platform, MedicalSourceQuery, MedicalSourceResult } from '../index';
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
    const results = await invoke<unknown[]>(cmd, {
      query: q.query,
      maxResults: q.maxResults ?? 25,
    });
    return {
      source,
      results,
      fetchedAt: new Date().toISOString(),
      provenanceHash: '', // TODO Phase 4 — Rust populates this
    };
  };

export const tauriPlatform: Platform = {
  keychain: {
    store: (key, value) => invoke('keychain_store', { key, value }),
    retrieve: (key) => invoke('keychain_retrieve', { key }),
    delete: (key) => invoke('keychain_delete', { key }),
  },

  audit: {
    append: (category, subject, action, payload) =>
      invoke<AuditEntry>('audit_log_append', { category, subject, action, payload }),
    read: () => invoke<AuditEntry[]>('audit_log_read'),
    verify: () => invoke<number | null>('audit_log_verify'),
  },

  medical: {
    pubmed: mkMedical('pubmed', 'pubmed_search'),
    europepmc: mkMedical('europepmc', 'europepmc_fetch'),
    openalex: mkMedical('openalex', 'openalex_query'),
    ctgov: mkMedical('ctgov', 'ctgov_search'),
    openfda: async (endpoint, q) => {
      const results = await invoke<unknown[]>('openfda_query', {
        endpoint,
        query: q.query,
      });
      return {
        source: 'openfda',
        results,
        fetchedAt: new Date().toISOString(),
        provenanceHash: '',
      };
    },
    rxnorm: async (drug) => {
      const results = await invoke<unknown[]>('rxnorm_lookup', { drug });
      return {
        source: 'rxnorm',
        results,
        fetchedAt: new Date().toISOString(),
        provenanceHash: '',
      };
    },
  },

  pdf: {
    extractText: (path) => invoke<string>('pdf_extract_text', { path }),
  },

  env: {
    isTauri: true,
    platform: detectPlatform(),
  },
};
