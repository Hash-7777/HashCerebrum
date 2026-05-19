//! RxNorm. Docs: https://lhncbc.nlm.nih.gov/RxNav/APIs/RxNormAPIs.html

use crate::commands::medical::{evidence, fetch_json, EvidenceItem};
use crate::error::AppResult;
use url::Url;

#[tauri::command]
pub async fn rxnorm_lookup(drug: String) -> AppResult<Vec<EvidenceItem>> {
    let mut url = Url::parse("https://rxnav.nlm.nih.gov/REST/drugs.json").unwrap();
    url.query_pairs_mut().append_pair("name", &drug);
    let json = fetch_json(url).await?;
    let groups = json
        .pointer("/drugGroup/conceptGroup")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for group in groups {
        let tty = group["tty"].as_str().unwrap_or("RxNorm");
        if let Some(concepts) = group["conceptProperties"].as_array() {
            for concept in concepts.iter().take(5) {
                let rxcui = concept["rxcui"].as_str().unwrap_or("");
                let name = concept["name"]
                    .as_str()
                    .unwrap_or("RxNorm concept")
                    .to_string();
                out.push(evidence(
                    "rxnorm",
                    name,
                    None,
                    Vec::new(),
                    serde_json::json!({ "rxcui": rxcui, "tty": tty }),
                    if rxcui.is_empty() {
                        None
                    } else {
                        Some(format!(
                            "https://rxnav.nlm.nih.gov/REST/rxcui/{rxcui}/allProperties.json"
                        ))
                    },
                    concept["synonym"].as_str().map(str::to_string),
                ));
            }
        }
    }
    Ok(out)
}
