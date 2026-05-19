//! PubMed via NCBI E-utilities.
//! Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/

use crate::error::AppResult;

#[tauri::command]
pub async fn pubmed_search(_query: String, _max_results: u32) -> AppResult<serde_json::Value> {
    // TODO Phase 4 — call esearch.fcgi + esummary.fcgi, parse to normalized shape
    Ok(serde_json::json!({ "results": [] }))
}
