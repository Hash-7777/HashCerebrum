//! PDF text extraction. Used by the Librarian agent to surface body
//! text from open-access biomedical papers so the synthesis pass can
//! ground claims in real prose, not just abstracts.
//!
//! lopdf is pure-Rust (no native deps) so we don't drag in a toolchain
//! requirement on every CI image.

use crate::error::{AppError, AppResult};
use crate::security::guard::{check, Action};
use lopdf::Document;
use std::path::PathBuf;

#[tauri::command]
pub async fn pdf_extract_text(path: String) -> AppResult<String> {
    check(Action::Fs { path: &path })?;
    let path: PathBuf = path.into();
    if !path.exists() {
        return Err(AppError::InvalidInput(format!(
            "pdf not found: {}",
            path.display()
        )));
    }

    // Read on a blocking thread so we don't tie up the tokio runtime
    // with the synchronous lopdf parser on a large file.
    let extracted = tokio::task::spawn_blocking(move || -> Result<String, lopdf::Error> {
        let doc = Document::load(&path)?;
        let pages = doc.get_pages();
        let mut out = String::new();
        for (page_num, _) in pages {
            if let Ok(text) = doc.extract_text(&[page_num]) {
                out.push_str(&text);
                out.push_str("\n\n");
            }
        }
        Ok(out)
    })
    .await
    .map_err(|e| AppError::Pdf(format!("join: {e}")))?
    .map_err(|e| AppError::Pdf(format!("parse: {e}")))?;

    Ok(extracted)
}
