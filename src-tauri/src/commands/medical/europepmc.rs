//! Europe PMC. Docs: https://europepmc.org/RestfulWebService

use crate::error::AppResult;

#[tauri::command]
pub async fn europepmc_fetch(_query: String) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({ "results": [] }))
}
