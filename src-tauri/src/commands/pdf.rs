//! PDF text extraction. Used by the Librarian agent to surface body
//! text from open-access biomedical papers so the synthesis pass can
//! ground claims in real prose, not just abstracts.
//!
//! lopdf is pure-Rust (no native deps) so we don't drag in a toolchain
//! requirement on every CI image.

use crate::commands::net::net_get_bytes;
use crate::error::{AppError, AppResult};
use lopdf::Document;

const MAX_PDF_BYTES: u64 = 50 * 1024 * 1024; // 50 MB
const MAX_EXTRACT_CHARS: usize = 10 * 1024 * 1024; // 10 MB of text

fn extract_text_from_document(doc: Document) -> String {
    let pages = doc.get_pages();
    let mut out = String::new();
    for (page_num, _) in pages {
        if let Ok(text) = doc.extract_text(&[page_num]) {
            out.push_str(&text);
            out.push_str("\n\n");
            if out.len() >= MAX_EXTRACT_CHARS {
                out.truncate(MAX_EXTRACT_CHARS);
                out.push_str("\n[truncated]");
                break;
            }
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
    let mut pages: Vec<String> = pages.into_iter().map(|(_, text)| text).collect();
    // Enforce the same per-document char cap across the page array.
    let mut total = 0usize;
    for page in &mut pages {
        if total.saturating_add(page.len()) > MAX_EXTRACT_CHARS {
            let allowed = MAX_EXTRACT_CHARS.saturating_sub(total);
            page.truncate(allowed);
            if total < MAX_EXTRACT_CHARS {
                page.push_str("\n[truncated]");
            }
            total = MAX_EXTRACT_CHARS;
        } else {
            total = total.saturating_add(page.len());
        }
    }
    pages
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

    if let Err(e) = crate::audit::store::append_async(
        "upload".into(),
        filename.clone(),
        "extract_pdf_text".into(),
        serde_json::json!({ "bytes": byte_len, "sha256": fingerprint }),
    )
    .await
    {
        tracing::error!("audit append failed for pdf_extract_text_bytes: {e}");
    }

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

    if let Err(e) = crate::audit::store::append_async(
        "upload".into(),
        filename.clone(),
        "extract_pdf_pages".into(),
        serde_json::json!({ "bytes": byte_len, "sha256": fingerprint, "pages": pages.len() }),
    )
    .await
    {
        tracing::error!("audit append failed for pdf_extract_pages_bytes: {e}");
    }

    Ok(pages)
}

/// Download an open-access PDF by URL and extract its text. Used when Semantic
/// Scholar (or another source) provides a direct PDF link so the Brain can
/// synthesise from full-text rather than abstracts only.
#[tauri::command]
pub async fn fetch_open_access_pdf(url: String) -> AppResult<String> {
    let bytes = net_get_bytes(url.clone()).await?;
    if bytes.len() < 4 || &bytes[0..4] != b"%PDF" {
        return Err(AppError::InvalidInput(
            "downloaded file is not a valid PDF (missing %PDF header)".into(),
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

    if let Err(e) = crate::audit::store::append_async(
        "net".into(),
        url.clone(),
        "fetch_open_access_pdf".into(),
        serde_json::json!({ "bytes": byte_len, "sha256": fingerprint, "chars": extracted.len() }),
    )
    .await
    {
        tracing::error!("audit append failed for fetch_open_access_pdf: {e}");
    }

    Ok(extracted)
}
