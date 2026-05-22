use crate::audit::{chain::AuditEntry, store};
use crate::error::AppResult;

#[tauri::command]
pub async fn audit_log_read() -> AppResult<Vec<AuditEntry>> {
    store::read_all()
}

#[tauri::command]
pub async fn audit_log_read_page(offset: u64, limit: u64) -> AppResult<Vec<AuditEntry>> {
    store::read_page(offset, limit)
}

#[tauri::command]
pub async fn audit_log_count() -> AppResult<u64> {
    store::count()
}

#[tauri::command]
pub async fn audit_log_verify() -> AppResult<Option<u64>> {
    store::verify()
}
