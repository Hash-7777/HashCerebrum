//! RxNorm. Docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html

use crate::error::AppResult;

#[tauri::command]
pub async fn rxnorm_lookup(_drug: String) -> AppResult<serde_json::Value> {
    Ok(serde_json::json!({ "concepts": [] }))
}
