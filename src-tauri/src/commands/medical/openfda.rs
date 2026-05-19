//! OpenFDA. Docs: https://open.fda.gov/apis/

use crate::error::AppResult;

#[tauri::command]
pub async fn openfda_query(_endpoint: String, _query: String) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({ "results": [] }))
}
