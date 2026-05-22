//! OpenFDA. Docs: https://open.fda.gov/apis/

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

#[tauri::command]
pub async fn openfda_query(
    endpoint: String,
    query: String,
    max_results: Option<u32>,
) -> AppResult<Vec<EvidenceItem>> {
    let safe_endpoint = match endpoint.as_str() {
        "drug/event" | "drug/label" | "drug/drugsfda" | "device/event" => endpoint,
        _ => "drug/event".to_string(),
    };
    let limit = clamp_max_results(max_results.unwrap_or(5), 5, 10);
    let mut url = Url::parse(&format!("https://api.fda.gov/{safe_endpoint}.json"))
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("search", &query)
        .append_pair("limit", &limit.to_string());
    let json = fetch_json(url, Some(172800)).await?;
    let results = json["results"].as_array().cloned().unwrap_or_default();
    Ok(results.into_iter().enumerate().map(|(i, item)| {
        let title = item["patient"]["drug"].as_array()
            .and_then(|arr| arr.first())
            .and_then(|drug| drug["medicinalproduct"].as_str())
            .or_else(|| item["openfda"]["brand_name"].as_array().and_then(|arr| arr.first()).and_then(|v| v.as_str()))
            .unwrap_or("OpenFDA record")
            .to_string();
        let snippet = item["serious"].as_str()
            .map(|s| format!("serious: {s}"))
            .or_else(|| item["purpose"].as_array().and_then(|arr| arr.first()).and_then(|v| v.as_str()).map(str::to_string));
        evidence(
            "openfda",
            title,
            item["receivedate"].as_str().and_then(|s| s.get(0..4)).map(str::to_string),
            Vec::new(),
            serde_json::json!({ "endpoint": safe_endpoint, "record": i + 1, "safetyreportid": item["safetyreportid"].as_str() }),
            None,
            snippet,
        )
    }).collect())
}
