//! PDF text extraction. Used by the Librarian agent to surface body
//! text from open-access biomedical papers so the synthesis pass can
//! ground claims in real prose, not just abstracts.
//!
//! lopdf is pure-Rust (no native deps) so we don't drag in a toolchain
//! requirement on every CI image.

use crate::error::{AppError, AppResult};
use lopdf::Document;

const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024; // 50 MB

fn extract_text_from_document(doc: Document) -> String {
    let pages = doc.get_pages();
    let mut out = String::new();
    for (page_num, _) in pages {
        if let Ok(text) = doc.extract_text(&[page_num]) {
            out.push_str(&text);
            out.push_str("\n\n");
        }
    }
    out
}

/// Extract text page by page, preserving page order, so the caller can attach a
/// page number to each passage (citation locality). A page that fails to extract
/// yields an empty string so indices stay aligned with the document's pages.
fn extract_pages_from_document(doc: Document) -> Vec<String> {
    let mut pages: Vec<(u32, String)> = doc
        .get_pages()
        .into_keys()
        .map(|page_num| {
            let text = doc.extract_text(&[page_num]).unwrap_or_default();
            (page_num, text)
        })
        .collect();
    pages.sort_by_key(|(n, _)| *n);
    pages.into_iter().map(|(_, text)| text).collect()
}

#[tauri::command]
pub async fn pdf_extract_text_bytes(filename: String, bytes: Vec<u8>) -> AppResult<String> {
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(AppError::InvalidInput("pdf exceeds 50 MB limit".into()));
    }
    // Validate magic bytes before invoking the parser — rejects non-PDF blobs
    // (e.g. a renamed .exe) without risking a parser panic on malformed data.
    if bytes.len() < 4 || &bytes[0..4] != b"%PDF" {
        return Err(AppError::InvalidInput(
            "not a valid PDF (missing %PDF header)".into(),
        ));
    }

    let byte_len = bytes.len();
    let fingerprint = crate::crypto::sha256_hex(&bytes);
    let extracted = tokio::task::spawn_blocking(move || -> Result<String, lopdf::Error> {
        let doc = Document::load_mem(&bytes)?;
        Ok(extract_text_from_document(doc))
    })
    .await
    .map_err(|e| AppError::Pdf(format!("join: {e}")))?
    .map_err(|e| AppError::Pdf(format!("parse: {e}")))?;

    let _ = crate::audit::store::append(
        "upload",
        &filename,
        "extract_pdf_text",
        &serde_json::json!({ "bytes": byte_len, "sha256": fingerprint }),
    );

    Ok(extracted)
}

/// Page-aware variant of [`pdf_extract_text_bytes`]: returns one string per page
/// (in page order) so an imported library document can cite the exact page a
/// passage came from. Same validation, limits, and audit trail.
#[tauri::command]
pub async fn pdf_extract_pages_bytes(filename: String, bytes: Vec<u8>) -> AppResult<Vec<String>> {
    if bytes.len() as u64 > MAX_PDF_BYTES {
        return Err(AppError::InvalidInput("pdf exceeds 50 MB limit".into()));
    }
    if bytes.len() < 4 || &bytes[0..4] != b"%PDF" {
        return Err(AppError::InvalidInput(
            "not a valid PDF (missing %PDF header)".into(),
        ));
    }

    let byte_len = bytes.len();
    let fingerprint = crate::crypto::sha256_hex(&bytes);
    let pages = tokio::task::spawn_blocking(move || -> Result<Vec<String>, lopdf::Error> {
        let doc = Document::load_mem(&bytes)?;
        Ok(extract_pages_from_document(doc))
    })
    .await
    .map_err(|e| AppError::Pdf(format!("join: {e}")))?
    .map_err(|e| AppError::Pdf(format!("parse: {e}")))?;

    let _ = crate::audit::store::append(
        "upload",
        &filename,
        "extract_pdf_pages",
        &serde_json::json!({ "bytes": byte_len, "sha256": fingerprint, "pages": pages.len() }),
    );

    Ok(pages)
}
