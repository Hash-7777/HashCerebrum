//! Europe PMC. Docs: https://europepmc.org/RestfulWebService

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, strip_html, truncate_chars,
    EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

#[tauri::command]
pub async fn europepmc_fetch(
    query: String,
    max_results: Option<u32>,
) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(12), 12, 40);
    let mut url = Url::parse("https://www.ebi.ac.uk/europepmc/webservices/rest/search")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("query", &query)
        .append_pair("format", "json")
        // `core` adds abstractText (and full metadata) — without it the search
        // returns only titles/journals, starving downstream extraction.
        .append_pair("resultType", "core")
        .append_pair("pageSize", &limit.to_string());
    let json = fetch_json(url, Some(86400)).await?;
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
            // Prefer the abstract; fall back to the journal name when Europe PMC
            // has no abstract for the record.
            let snippet = item["abstractText"]
                .as_str()
                .map(|s| truncate_chars(&strip_html(s), 2000))
                .filter(|s| !s.is_empty())
                .or_else(|| item["journalTitle"].as_str().map(str::to_string));
            evidence(
                "europepmc",
                title,
                year,
                authors,
                serde_json::json!({ "pmid": pmid, "doi": doi, "source": item["source"].as_str() }),
                url,
                snippet,
            )
        })
        .collect())
}
