//! GDPR right-to-erasure — project-scoped data purge.
//! Removes all project-specific RAG, chat, run, and cache data.
//! Audit entries naming the project are redacted (overwritten with
//! [REDACTED]) and the hash chain is then recomputed, so erasing a project
//! leaves `audit_log_verify` reporting the log intact rather than corrupted.

use crate::audit::store as audit;
use crate::error::{AppError, AppResult};
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

    // 2. Redact audit entries mentioning this project_id, then re-chain the
    // log so it still verifies (see audit::store::redact_and_rechain).
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

/// Escape the LIKE metacharacters so a project id is matched literally.
///
/// `is_valid_project_id` permits `_`, which LIKE reads as "any single
/// character" — without escaping, purging `trial_1` would also redact entries
/// belonging to `trialX1`, erasing audit history for a project the user did not
/// ask to erase. `%` and `\` cannot appear in a valid id but are escaped anyway
/// so this stays correct if the id rules are ever loosened.
fn escape_like(term: &str) -> String {
    let mut out = String::with_capacity(term.len());
    for ch in term.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

async fn redact_audit_for_project(project_id: &str) -> AppResult<u64> {
    let pattern = escape_like(project_id);
    let project_id = project_id.to_string();
    let count =
        audit::with_connection_async(move |conn| audit::redact_and_rechain(conn, &pattern)).await?;
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
