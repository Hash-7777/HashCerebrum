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
mod swarm;
mod telemetry;

use tauri::Manager;

use commands::{
    audit::{
        audit_log_count, audit_log_read, audit_log_read_page, audit_log_reset, audit_log_verify,
    },
    cache::{cache_clear, cache_clear_expired, cache_stats},
    files::write_file_bytes,
    keychain::{keychain_delete, keychain_retrieve, keychain_store},
    llm::{llm_chat_stream, llm_chat_stream_abort, llm_http_get, llm_http_post},
    manuscript::render_manuscript_pdf,
    medical::{
        clinvar::clinvar_search, crossref::crossref_lookup, ctgov::ctgov_search,
        europepmc::europepmc_fetch, europepmc::europepmc_fulltext,
        gwas_catalog::gwas_catalog_search, openalex::openalex_query, openfda::openfda_query,
        pubmed::pubmed_search, rxnorm::rxnorm_lookup, semantic_scholar::semantic_scholar_search,
    },
    net::{net_get, net_get_bytes},
    notch::notch_activity_post,
    pdf::{fetch_open_access_pdf, pdf_extract_pages_bytes, pdf_extract_text_bytes},
    purge::purge_project_data,
    swarm::{swarm_cancel_job, swarm_get_job, swarm_list_jobs, swarm_start_job},
    usage_log::usage_log_append,
};

/// Restart the application. Invoked from the titlebar restart button.
#[tauri::command]
fn app_relaunch(app: tauri::AppHandle) {
    app.restart();
}

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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            security::guard::init(app.handle())?;
            audit::init(app.handle())?;
            cache::init(app.handle())?;
            telemetry::init(app.handle())?;
            let supervisor = swarm::init(app.handle())?;
            app.manage(supervisor);
            // Window geometry (size + position) is remembered by the frontend: it
            // restores the saved geometry and THEN shows the window in one beat
            // (see src/platform/revealWindow.ts). Doing the restore in JS right
            // before `show()` is what makes it stick on macOS — geometry is set
            // while the window is still hidden and revealed in the same sequence,
            // so the window manager never gets a chance to re-place it.
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
            audit_log_reset,
            net_get,
            net_get_bytes,
            llm_http_get,
            llm_http_post,
            llm_chat_stream,
            llm_chat_stream_abort,
            pubmed_search,
            europepmc_fetch,
            europepmc_fulltext,
            openalex_query,
            ctgov_search,
            openfda_query,
            rxnorm_lookup,
            semantic_scholar_search,
            crossref_lookup,
            gwas_catalog_search,
            clinvar_search,
            pdf_extract_text_bytes,
            pdf_extract_pages_bytes,
            fetch_open_access_pdf,
            write_file_bytes,
            usage_log_append,
            notch_activity_post,
            render_manuscript_pdf,
            cache_stats,
            cache_clear,
            cache_clear_expired,
            purge_project_data,
            telemetry::trace_read,
            swarm_start_job,
            swarm_cancel_job,
            swarm_get_job,
            swarm_list_jobs,
            app_relaunch,
        ])
        .build(tauri::generate_context!())
    {
        Ok(app) => app.run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Window geometry is persisted from the frontend on every
                // move/resize (see src/platform/revealWindow.ts), so nothing to
                // save here — just close the database connections cleanly.
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
