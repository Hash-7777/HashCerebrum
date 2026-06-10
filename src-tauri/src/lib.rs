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
        europepmc::europepmc_fetch, gwas_catalog::gwas_catalog_search, openalex::openalex_query,
        openfda::openfda_query, pubmed::pubmed_search, rxnorm::rxnorm_lookup,
        semantic_scholar::semantic_scholar_search,
    },
    net::{net_get, net_get_bytes},
    pdf::{fetch_open_access_pdf, pdf_extract_pages_bytes, pdf_extract_text_bytes},
    purge::purge_project_data,
    swarm::{swarm_cancel_job, swarm_get_job, swarm_list_jobs, swarm_start_job},
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
        .plugin(
            // Restore size/position/maximised, but NOT visibility: the window is
            // created hidden (tauri.conf.json) and the frontend reveals it only
            // after the dark UI has painted. Without excluding VISIBLE here, this
            // plugin re-shows the window on launch, flashing the blank WebView
            // white before the page renders.
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                )
                .build(),
        )
        .setup(|app| {
            security::guard::init(app.handle())?;
            audit::init(app.handle())?;
            cache::init(app.handle())?;
            telemetry::init(app.handle())?;
            let supervisor = swarm::init(app.handle())?;
            app.manage(supervisor);
            // First launch only (no saved window state yet): center the main
            // window. On later launches the window-state plugin restores the saved
            // geometry, so we must NOT re-center — that is what made the window
            // forget its position. `center: true` in tauri.conf.json was removed
            // for the same reason (it re-centered on every launch).
            if let Some(win) = app.get_webview_window("main") {
                let has_saved_state = app
                    .path()
                    .app_config_dir()
                    .map(|dir| {
                        dir.join(".window-state.json").exists()
                            || dir.join("window-state.json").exists()
                    })
                    .unwrap_or(false);
                if !has_saved_state {
                    let _ = win.center();
                }
                // Save geometry to disk immediately when the window closes,
                // before the app exits (macOS Cmd+Q may destroy the window
                // before RunEvent::Exit fires, leaving stale cache).
                let app_handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { .. } = event {
                        let _ = tauri_plugin_window_state::AppHandleExt::save_window_state(
                            &app_handle,
                            tauri_plugin_window_state::StateFlags::all()
                                .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                        );
                    }
                });
            }
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
        Ok(app) => app.run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                // Guarantee the window geometry is persisted on exit, independent
                // of window close-event timing — so size and position are
                // remembered on the next launch.
                let _ = tauri_plugin_window_state::AppHandleExt::save_window_state(
                    app_handle,
                    tauri_plugin_window_state::StateFlags::all()
                        .difference(tauri_plugin_window_state::StateFlags::VISIBLE),
                );
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
