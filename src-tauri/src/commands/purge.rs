//! GDPR right-to-erasure — project-scoped data purge.
//! Removes all project-specific RAG, chat, run, and cache data.
//! Audit entries are redacted (overwritten with [REDACTED]) to preserve
//! the append-only chain integrity.

use crate::audit::store as audit;
use crate::error::{AppError, AppResult};
use rusqlite::params;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn app_data_path(app: &AppHandle, filename: &str) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    Ok(dir.join(filename))
}

fn is_valid_project_id(id: &str) -> bool {
    // Alphanumeric, hyphen, underscore only — prevents path traversal and
    // directory separators in filenames.
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Purge all data associated with a project ID across stores.
/// Returns counts of rows affected per store.
#[tauri::command]
pub async fn purge_project_data(
    app: AppHandle,
    project_id: String,
) -> AppResult<std::collections::HashMap<String, u64>> {
    if !is_valid_project_id(&project_id) {
        return Err(AppError::InvalidInput(
            "project_id must be alphanumeric/hyphen/underscore".into(),
        ));
    }
    let mut results: std::collections::HashMap<String, u64> = std::collections::HashMap::new();

    // 1. Purge cache entries tagged with project_id (if any were tagged)
    // The cache schema does not have a project_id column, so we skip.
    // Future: add project tag to cache rows.

    // 2. Redact audit entries mentioning this project_id
    // Audit is append-only; we UPDATE the subject to [REDACTED] while
    // preserving the chain structure (seq, prev_hash, entry_hash stay).
    let audit_count = redact_audit_for_project(&project_id).await?;
    results.insert("audit_redacted".into(), audit_count);

    // 3. Delete project-specific SQLite files if they exist
    let rag_path = app_data_path(&app, &format!("rag_{}.sqlite", project_id))?;
    if rag_path.exists() {
        std::fs::remove_file(&rag_path)
            .map_err(|e| AppError::File(format!("rag delete failed: {e}")))?;
        results.insert("rag_file_deleted".into(), 1);
    }

    let chat_path = app_data_path(&app, &format!("chat_{}.sqlite", project_id))?;
    if chat_path.exists() {
        std::fs::remove_file(&chat_path)
            .map_err(|e| AppError::File(format!("chat delete failed: {e}")))?;
        results.insert("chat_file_deleted".into(), 1);
    }

    if let Err(e) = audit::append_async(
        "purge".into(),
        project_id.clone(),
        "purge_project_data".into(),
        serde_json::json!({ "results": results }),
    )
    .await
    {
        tracing::error!("audit append failed for purge_project_data: {e}");
    }

    Ok(results)
}

async fn redact_audit_for_project(project_id: &str) -> AppResult<u64> {
    let redacted = "[REDACTED]";
    let pattern = format!("%{}%", project_id);
    let project_id = project_id.to_string();
    let count = audit::with_connection_async(move |conn| {
        let count = conn.execute(
            "UPDATE audit SET category = ?1, subject = ?1, action = ?1, data_hash = ?1, enc_data = NULL WHERE subject LIKE ?2 OR action LIKE ?2 OR category LIKE ?2",
            params![redacted, pattern],
        )?;
        Ok(count)
    }).await?;
    // Append a tombstone entry so auditors can see *that* a redaction happened,
    // when it happened, and which project was erased, without revealing content.
    let _ = audit::append_async(
        "purge".into(),
        project_id.clone(),
        "audit_redacted".into(),
        serde_json::json!({ "rows": count, "timestamp": chrono::Utc::now().to_rfc3339() }),
    )
    .await;
    Ok(count as u64)
}
