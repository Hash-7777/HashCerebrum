//! OpenAlex. Docs: https://docs.openalex.org/

use crate::error::AppResult;

#[tauri::command]
pub async fn openalex_query(_query: String) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({ "results": [] }))
}
