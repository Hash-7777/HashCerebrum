use crate::audit::{chain::AuditEntry, store};
use crate::error::AppResult;

/// Renderer-facing read. Bounded to the most recent entries so a large audit
/// log cannot OOM the process or balloon the IPC payload; older history is
/// reachable through the paged command.
#[tauri::command]
pub async fn audit_log_read() -> AppResult<Vec<AuditEntry>> {
    store::read_recent_async(5_000).await
}

#[tauri::command]
pub async fn audit_log_read_page(offset: u64, limit: u64) -> AppResult<Vec<AuditEntry>> {
    store::read_page_async(offset, limit).await
}

#[tauri::command]
pub async fn audit_log_count() -> AppResult<u64> {
    store::count_async().await
}

#[tauri::command]
pub async fn audit_log_verify() -> AppResult<Option<u64>> {
    store::verify_async().await
}

/// Clear the audit log to a fresh chain. Used to retire a legacy chain (older
/// hash format or the encrypted build) so verification reads intact again.
#[tauri::command]
pub async fn audit_log_reset() -> AppResult<()> {
    store::reset_async().await
}
