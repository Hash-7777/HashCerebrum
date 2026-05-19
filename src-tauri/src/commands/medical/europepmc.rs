//! Europe PMC. Docs: https://europepmc.org/RestfulWebService

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::AppResult;
use url::Url;

#[tauri::command]
pub async fn europepmc_fetch(
    query: String,
    max_results: Option<u32>,
) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(8), 8, 20);
    let mut url = Url::parse("https://www.ebi.ac.uk/europepmc/webservices/rest/search").unwrap();
    url.query_pairs_mut()
        .append_pair("query", &query)
        .append_pair("format", "json")
        .append_pair("pageSize", &limit.to_string());
    let json = fetch_json(url).await?;
    let results = json
        .pointer("/resultList/result")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results
        .into_iter()
        .map(|item| {
            let title = item["title"]
                .as_str()
                .unwrap_or("Untitled Europe PMC record")
                .to_string();
            let year = item["pubYear"].as_str().map(str::to_string);
            let authors = item["authorString"]
                .as_str()
                .map(|s| {
                    s.split(',')
                        .map(|a| a.trim().trim_end_matches('.').to_string())
                        .filter(|a| !a.is_empty())
                        .take(8)
                        .collect()
                })
                .unwrap_or_default();
            let pmid = item["pmid"].as_str().map(str::to_string);
            let doi = item["doi"].as_str().map(str::to_string);
            let url = item["pmid"]
                .as_str()
                .map(|id| format!("https://europepmc.org/article/MED/{id}"));
            evidence(
                "europepmc",
                title,
                year,
                authors,
                serde_json::json!({ "pmid": pmid, "doi": doi, "source": item["source"].as_str() }),
                url,
                item["journalTitle"].as_str().map(str::to_string),
            )
        })
        .collect())
}
