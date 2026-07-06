//! OpenFDA. Docs: https://open.fda.gov/apis/

use crate::commands::medical::{
    compact_query_terms, evidence, fetch_json_optional, max_results as clamp_max_results,
    EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

fn searchable_fields(endpoint: &str) -> &'static [&'static str] {
    match endpoint {
        "drug/label" => &[
            "openfda.brand_name",
            "openfda.generic_name",
            "indications_and_usage",
        ],
        "drug/drugsfda" => &[
            "openfda.brand_name",
            "openfda.generic_name",
            "products.brand_name",
        ],
        "device/event" => &["device.brand_name", "mdr_text.text"],
        _ => &[
            "patient.drug.medicinalproduct",
            "patient.drug.openfda.generic_name",
            "patient.reaction.reactionmeddrapt",
        ],
    }
}

fn openfda_search(endpoint: &str, query: &str) -> String {
    let terms = compact_query_terms(query, 6);
    let fields = searchable_fields(endpoint);

    terms
        .iter()
        .map(|term| {
            let clauses: Vec<String> = fields
                .iter()
                .map(|field| format!("{field}:\"{term}\""))
                .collect();
            if clauses.len() == 1 {
                clauses.into_iter().next().unwrap()
            } else {
                format!("({})", clauses.join(" OR "))
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

#[tauri::command]
pub async fn openfda_query(
    endpoint: String,
    query: String,
    max_results: Option<u32>,
) -> AppResult<Vec<EvidenceItem>> {
    let safe_endpoint = match endpoint.as_str() {
        "drug/event" | "drug/label" | "drug/drugsfda" | "device/event" => endpoint,
        _ => {
            return Err(AppError::InvalidInput(
                format!("endpoint '{endpoint}' is not supported. Use drug/event, drug/label, drug/drugsfda, or device/event.")
            ));
        }
    };
    let limit = clamp_max_results(max_results.unwrap_or(5), 5, 10);
    let mut url = Url::parse(&format!("https://api.fda.gov/{safe_endpoint}.json"))
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let search = openfda_search(&safe_endpoint, &query);
    if search.is_empty() {
        return Err(AppError::InvalidInput(
            "Query contains no valid OpenFDA search terms after sanitization".into(),
        ));
    }
    url.query_pairs_mut()
        .append_pair("search", &search)
        .append_pair("limit", &limit.to_string());
    // OpenFDA returns HTTP 404 ("No matches found!") for a zero-result search, not
    // an empty list. Treat that as no matching records — a normal outcome — rather
    // than a network error, so a specific drug-safety query that simply has no
    // adverse-event reports degrades gracefully instead of failing the source.
    let json = match fetch_json_optional(url, Some(172800)).await? {
        Some(json) => json,
        None => return Ok(Vec::new()),
    };
    let results = json["results"].as_array().cloned().unwrap_or_default();
    Ok(results.into_iter().enumerate().map(|(i, item)| {
        let title = item["patient"]["drug"].as_array()
            .and_then(|arr| arr.first())
            .and_then(|drug| drug["medicinalproduct"].as_str())
            .or_else(|| item["openfda"]["brand_name"].as_array().and_then(|arr| arr.first()).and_then(|v| v.as_str()))
            .unwrap_or("OpenFDA record")
            .to_string();
        let snippet = item["patient"]["reaction"].as_array()
            .and_then(|arr| arr.first())
            .and_then(|r| r["reactionmeddrapt"].as_str())
            .map(|s| format!("reaction: {s}"))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openfda_search_builds_fielded_query_from_free_text() {
        let search = openfda_search(
            "drug/event",
            "Drug safety: warfarin and amiodarone interaction, bleeding risk in patients",
        );

        assert!(search.contains("patient.drug.medicinalproduct:\"warfarin\""));
        assert!(search.contains("patient.reaction.reactionmeddrapt:\"bleeding\""));
        assert!(!search.contains("Drug safety:"));
        assert!(!search.contains("patients"));
    }

    #[test]
    fn openfda_search_uses_endpoint_specific_fields() {
        let search = openfda_search("drug/label", "aspirin boxed warning");

        assert!(search.contains("openfda.brand_name:\"aspirin\""));
        assert!(search.contains("indications_and_usage:\"warning\""));
        assert!(!search.contains("patient.drug.medicinalproduct"));
    }

    #[test]
    fn openfda_search_groups_terms_with_and_fields_with_or() {
        let search = openfda_search("drug/event", "warfarin bleeding");

        // Each term should be grouped in parentheses with OR across fields.
        assert!(search.contains("(patient.drug.medicinalproduct:\"warfarin\" OR patient.drug.openfda.generic_name:\"warfarin\" OR patient.reaction.reactionmeddrapt:\"warfarin\")"));
        assert!(search.contains("(patient.drug.medicinalproduct:\"bleeding\" OR patient.drug.openfda.generic_name:\"bleeding\" OR patient.reaction.reactionmeddrapt:\"bleeding\")"));
        // Terms should be joined with AND.
        assert!(search.contains(" AND "));
    }

    #[test]
    fn openfda_search_multi_field_endpoint_uses_parens() {
        // device/event has two fields, so parentheses should be used.
        let search = openfda_search("device/event", "pacemaker");
        assert!(search.contains('('));
        assert!(search.contains(')'));
        assert!(search.contains("device.brand_name:\"pacemaker\""));
    }
}
