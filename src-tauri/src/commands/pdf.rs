//! PDF text extraction. Implementation deferred to Phase 4
//! (will use `pdf-extract` or `lopdf`).

use crate::error::AppResult;

#[tauri::command]
pub async fn pdf_extract_text(_path: String) -> AppResult<String> {
    // TODO Phase 4 — implement PDF text extraction
    Ok(String::new())
}
