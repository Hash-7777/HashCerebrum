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

/// A v2 numeric field can arrive as a JSON string ("0.74") or a number (0.74).
fn num_str(value: &serde_json::Value) -> Option<String> {
    if let Some(s) = value.as_str() {
        let s = s.trim();
        return (!s.is_empty()).then(|| s.to_string());
    }
    value.as_f64().map(|f| f.to_string())
}

/// Map a v2 `paramType` to a ratio abbreviation the extractor recognises.
fn ratio_abbrev(param_type: &str) -> Option<&'static str> {
    let p = param_type.to_ascii_lowercase();
    if p.contains("hazard") {
        Some("HR")
    } else if p.contains("odds") {
        Some("OR")
    } else if p.contains("risk ratio") || p.contains("relative risk") {
        Some("RR")
    } else {
        None
    }
}

/// Turn the STRUCTURED results section (real effect estimates from posted trial
/// results — paramType/paramValue/CI/pValue per outcome) into a "Results:" block
/// the TS bound-effect extractor reads, so a hazard ratio carries its true
/// outcome, CI, and p-value instead of being scraped from prose.
fn format_trial_results(results: &serde_json::Value) -> Option<String> {
    let measures = results["outcomeMeasuresModule"]["outcomeMeasures"].as_array()?;
    let mut parts: Vec<String> = Vec::new();
    for measure in measures {
        let outcome = measure["title"].as_str().unwrap_or("outcome").trim();
        let Some(analyses) = measure["analyses"].as_array() else {
            continue;
        };
        for analysis in analyses {
            let Some(abbrev) = analysis["paramType"].as_str().and_then(ratio_abbrev) else {
                continue;
            };
            let Some(value) = num_str(&analysis["paramValue"]) else {
                continue;
            };
            let lo = num_str(&analysis["ciLowerLimit"]);
            let hi = num_str(&analysis["ciUpperLimit"]);
            let p = num_str(&analysis["pValue"]);
            let ci = match (lo, hi) {
                (Some(lo), Some(hi)) => match &p {
                    Some(p) => format!(" (95% CI {lo}-{hi}; p={p})"),
                    None => format!(" (95% CI {lo}-{hi})"),
                },
                _ => match &p {
                    Some(p) => format!(" (p={p})"),
                    None => String::new(),
                },
            };
            parts.push(format!("{outcome}: {abbrev} {value}{ci}"));
            if parts.len() >= 8 {
                break;
            }
        }
        if parts.len() >= 8 {
            break;
        }
    }
    (!parts.is_empty()).then(|| format!("Results: {}.", parts.join("; ")))
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
            // Real structured effect estimates from the trial's posted results.
            let results = format_trial_results(&study["resultsSection"]);
            let snippet = match (conditions, results) {
                (Some(c), Some(r)) => Some(format!("{c}. {r}")),
                (Some(c), None) => Some(c),
                (None, Some(r)) => Some(r),
                (None, None) => None,
            };
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
                snippet,
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_trial_results_extracts_structured_effect_estimates() {
        let results = serde_json::json!({
            "outcomeMeasuresModule": {
                "outcomeMeasures": [{
                    "title": "Cardiovascular Death or HF Hospitalization",
                    "analyses": [{
                        "paramType": "Hazard Ratio (HR)",
                        "paramValue": "0.74",
                        "ciLowerLimit": "0.65",
                        "ciUpperLimit": "0.85",
                        "pValue": "0.0008"
                    }]
                }]
            }
        });
        let out = format_trial_results(&results).expect("should produce a results block");
        assert_eq!(
            out,
            "Results: Cardiovascular Death or HF Hospitalization: HR 0.74 (95% CI 0.65-0.85; p=0.0008)."
        );
    }

    #[test]
    fn format_trial_results_handles_numeric_values_and_skips_non_ratios() {
        let results = serde_json::json!({
            "outcomeMeasuresModule": {
                "outcomeMeasures": [{
                    "title": "Mean change in 6MWD",
                    "analyses": [{ "paramType": "Mean Difference (Final Values)", "paramValue": "12.0" }]
                }, {
                    "title": "Stroke",
                    "analyses": [{ "paramType": "Odds Ratio (OR)", "paramValue": 0.89, "pValue": 0.01 }]
                }]
            }
        });
        let out = format_trial_results(&results).expect("should produce a results block");
        assert!(!out.contains("Mean Difference"), "non-ratio skipped: {out}");
        assert!(out.contains("Stroke: OR 0.89 (p=0.01)"), "got: {out}");
    }

    #[test]
    fn format_trial_results_none_without_posted_results() {
        assert!(format_trial_results(&serde_json::json!({})).is_none());
    }

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
