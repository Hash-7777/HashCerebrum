//! ClinicalTrials.gov v2 API.
//! Docs: https://clinicaltrials.gov/data-api/api

use crate::commands::medical::{
    compact_query, evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

/// ClinicalTrials.gov's `query.term` field uses the Essie search syntax and
/// returns HTTP 400 for over-long "too complicated" searches. Reduce any
/// agent-supplied free text to a short keyword query that avoids operators.
fn sanitize_term(query: &str) -> String {
    compact_query(query, 8)
}

#[tauri::command]
pub async fn ctgov_search(query: String, max_results: Option<u32>) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(10), 10, 30);
    let term = sanitize_term(&query);
    let mut url = Url::parse("https://clinicaltrials.gov/api/v2/studies")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    if term.is_empty() {
        return Err(AppError::InvalidInput(
            "Query contains no valid search terms after sanitization".into(),
        ));
    }
    url.query_pairs_mut()
        .append_pair("query.term", &term)
        .append_pair("pageSize", &limit.to_string());
    let json = fetch_json(url, Some(172800)).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_term_limits_complex_agent_text() {
        let term = sanitize_term(
            "What are the risks of warfarin and amiodarone interaction in elderly patients with atrial fibrillation clinical trial safety bleeding registry pharmacology public health?",
        );

        assert_eq!(
            term,
            "risks warfarin amiodarone interaction elderly atrial fibrillation safety"
        );
        assert!(term.split_whitespace().count() <= 8);
        assert!(!term.contains('?'));
    }
}
