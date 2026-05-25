// ==============================================================
// HashCerebrum — Rust library entry point
//
// LAYERS (top-down):
//   commands::*     — Tauri IPC surface, the ONLY thing renderer can call
//   security::guard — every command that touches network/fs/keychain goes through here
//   audit::*        — hash-chained append-only log of every guarded action
//   cache::*        — SQLite cache for medical-source responses
//   ratelimit::*    — per-host token-bucket limiters
//   crypto::*       — sha256/hex helpers used by audit chain + provenance
//
// SECURITY INVARIANTS:
//   1. All external HTTP — medical sources and LLM providers — is initiated
//      from Rust. The renderer's connect-src has no external hosts.
//   2. Every Rust network call passes through security::guard::check().
//   3. Every guarded action emits an audit entry chained to the previous.
//   4. API keys live in the renderer keychain bundle; Rust receives them
//      per call inside request headers and never logs header values.
//   5. The renderer cannot bypass any of this — capabilities.json restricts
//      it to the small allowlist of commands registered below.
// ==============================================================

mod audit;
mod cache;
mod commands;
mod crypto;
mod error;
mod ratelimit;
mod security;

use commands::{
    audit::{audit_log_count, audit_log_read, audit_log_read_page, audit_log_verify},
    cache::{cache_clear, cache_clear_expired, cache_stats},
    keychain::{keychain_delete, keychain_retrieve, keychain_store},
    llm::{llm_chat_stream, llm_chat_stream_abort, llm_http_get, llm_http_post},
    manuscript::render_manuscript_pdf,
    medical::{
        ctgov::ctgov_search, europepmc::europepmc_fetch, openalex::openalex_query,
        openfda::openfda_query, pubmed::pubmed_search, rxnorm::rxnorm_lookup,
        semantic_scholar::semantic_scholar_search,
    },
    net::net_get,
    pdf::{pdf_extract_text, pdf_extract_text_bytes},
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Structured logging — RUST_LOG env controls verbosity.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,hashcerebrum=debug".into()),
        )
        .init();

    match tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            security::guard::init(app.handle())?;
            audit::init(app.handle())?;
            cache::init(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            keychain_store,
            keychain_retrieve,
            keychain_delete,
            audit_log_read,
            audit_log_read_page,
            audit_log_count,
            audit_log_verify,
            net_get,
            llm_http_get,
            llm_http_post,
            llm_chat_stream,
            llm_chat_stream_abort,
            pubmed_search,
            europepmc_fetch,
            openalex_query,
            ctgov_search,
            openfda_query,
            rxnorm_lookup,
            semantic_scholar_search,
            pdf_extract_text,
            pdf_extract_text_bytes,
            render_manuscript_pdf,
            cache_stats,
            cache_clear,
            cache_clear_expired,
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app.run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                if let Err(e) = cache::close_connection() {
                    tracing::warn!("Cache close error on exit: {}", e);
                }
                if let Err(e) = audit::close_connection() {
                    tracing::warn!("Audit close error on exit: {}", e);
                }
            }
        }),
        Err(e) => tracing::error!("Tauri build error: {}", e),
    };
}
