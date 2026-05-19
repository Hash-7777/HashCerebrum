//! ClinicalTrials.gov v2 API.
//! Docs: https://clinicaltrials.gov/data-api/api

use crate::error::AppResult;

#[tauri::command]
pub async fn ctgov_search(_query: String) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({ "studies": [] }))
}
