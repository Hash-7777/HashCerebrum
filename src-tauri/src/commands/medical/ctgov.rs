//! ClinicalTrials.gov v2 API.
//! Docs: https://clinicaltrials.gov/data-api/api

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::AppResult;
use url::Url;

/// ClinicalTrials.gov's `query.term` field uses the Essie search syntax, which
/// rejects free text containing operator characters (parentheses, quotes,
/// colons, brackets) or an over-long phrase with an upstream HTTP 400. Reduce
/// any agent-supplied query to plain keyword search, which Essie always
/// accepts. Unicode letters (e.g. "Behçet") and hyphenated terms are kept.
fn sanitize_term(query: &str) -> String {
    query
        .split(|c: char| !(c.is_alphanumeric() || c == '-'))
        .filter(|word| !word.is_empty())
        .take(24)
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub async fn ctgov_search(query: String, max_results: Option<u32>) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(8), 8, 20);
    let term = sanitize_term(&query);
    let mut url = Url::parse("https://clinicaltrials.gov/api/v2/studies").unwrap();
    url.query_pairs_mut()
        .append_pair("query.term", if term.is_empty() { &query } else { &term })
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
