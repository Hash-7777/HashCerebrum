//! Local file writing for exports. The renderer picks a destination with the
//! native save dialog (tauri-plugin-dialog, in JS), then hands the chosen path
//! and the bytes here to be written. WKWebView does not honour `<a download>`
//! for blob URLs, so this is the reliable path for saving generated PDFs,
//! manuscripts, and data exports to disk.

use crate::error::{AppError, AppResult};
use std::path::PathBuf;

const MAX_SAVE_BYTES: usize = 100 * 1024 * 1024; // 100 MB

/// Write `bytes` to `path` (a destination the user already chose via the save
/// dialog). Bounded in size; the write runs off the async runtime thread.
#[tauri::command]
pub async fn write_file_bytes(path: String, bytes: Vec<u8>) -> AppResult<()> {
    if bytes.len() > MAX_SAVE_BYTES {
        return Err(AppError::InvalidInput("file exceeds 100 MB limit".into()));
    }
    if path.trim().is_empty() {
        return Err(AppError::InvalidInput("no destination path".into()));
    }
    let target = PathBuf::from(&path);
    tokio::task::spawn_blocking(move || std::fs::write(&target, &bytes))
        .await
        .map_err(|e| AppError::File(format!("join: {e}")))?
        .map_err(|e| AppError::File(format!("write: {e}")))?;
    Ok(())
}
