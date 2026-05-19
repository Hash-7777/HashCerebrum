use crate::audit::{chain::AuditEntry, store};
use crate::error::AppResult;

#[tauri::command]
pub async fn audit_log_append(
    category: String,
    subject: String,
    action: String,
    payload: serde_json::Value,
) -> AppResult<AuditEntry> {
    store::append(&category, &subject, &action, &payload)
}

#[tauri::command]
pub async fn audit_log_read() -> AppResult<Vec<AuditEntry>> {
    store::read_all()
}

#[tauri::command]
pub async fn audit_log_verify() -> AppResult<Option<u64>> {
    store::verify()
}
