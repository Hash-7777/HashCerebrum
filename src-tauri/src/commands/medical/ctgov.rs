//! ClinicalTrials.gov v2 API.
//! Docs: https://clinicaltrials.gov/data-api/api

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::AppResult;
use url::Url;

#[tauri::command]
pub async fn ctgov_search(query: String, max_results: Option<u32>) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(8), 8, 20);
    let mut url = Url::parse("https://clinicaltrials.gov/api/v2/studies").unwrap();
    url.query_pairs_mut()
        .append_pair("query.term", &query)
        .append_pair("pageSize", &limit.to_string());
    let json = fetch_json(url).await?;
    let studies = json["studies"].as_array().cloned().unwrap_or_default();
    Ok(studies
        .into_iter()
        .map(|study| {
            let protocol = &study["protocolSection"];
            let id = protocol["identificationModule"]["nctId"]
                .as_str()
                .unwrap_or("");
            let title = protocol["identificationModule"]["briefTitle"]
                .as_str()
                .unwrap_or("Untitled clinical trial")
                .to_string();
            let status = protocol["statusModule"]["overallStatus"]
                .as_str()
                .map(str::to_string);
            let conditions = protocol["conditionsModule"]["conditions"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                });
            evidence(
                "ctgov",
                title,
                protocol["statusModule"]["startDateStruct"]["date"]
                    .as_str()
                    .and_then(|s| s.get(0..4))
                    .map(str::to_string),
                Vec::new(),
                serde_json::json!({ "nctId": id, "status": status }),
                if id.is_empty() {
                    None
                } else {
                    Some(format!("https://clinicaltrials.gov/study/{id}"))
                },
                conditions,
            )
        })
        .collect())
}
