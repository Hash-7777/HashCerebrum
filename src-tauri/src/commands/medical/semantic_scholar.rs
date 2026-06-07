//! Semantic Scholar — academic search with citation context.
//! Docs: https://api.semanticscholar.org/api-docs/
//! No API key required for basic search (rate limit: 100 req/5min).

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

#[tauri::command]
pub async fn semantic_scholar_search(
    query: String,
    max_results: u32,
) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results, 12, 40);
    let mut url = Url::parse("https://api.semanticscholar.org/graph/v1/paper/search")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("query", &query)
        .append_pair(
            "fields",
            "title,authors,year,abstract,openAccessPdf,externalIds,publicationDate,journal,isRetracted",
        )
        .append_pair("limit", &limit.to_string());

    let json = fetch_json(url, Some(21600)).await?; // 6h TTL
    let papers = json
        .get("data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|paper| {
                    let title = paper["title"].as_str()?.to_string();
                    let year = paper["year"].as_u64().map(|y| y.to_string());
                    let authors = paper["authors"]
                        .as_array()
                        .map(|arr| {
                            arr.iter()
                                .filter_map(|a| a["name"].as_str().map(str::to_string))
                                .take(8)
                                .collect()
                        })
                        .unwrap_or_default();
                    let external_ids = paper["externalIds"]
                        .as_object()
                        .cloned()
                        .unwrap_or_default();
                    let doi = external_ids
                        .get("DOI")
                        .and_then(|v| v.as_str().map(str::to_string));
                    let pmid = external_ids
                        .get("PubMed")
                        .and_then(|v| v.as_str().map(str::to_string));
                    let url = doi
                        .as_ref()
                        .map(|d| format!("https://doi.org/{d}"))
                        .or_else(|| {
                            pmid.as_ref()
                                .map(|p| format!("https://pubmed.ncbi.nlm.nih.gov/{p}/"))
                        });
                    let open_access_pdf =
                        paper["openAccessPdf"]["url"].as_str().map(str::to_string);
                    let is_retracted = paper["isRetracted"].as_bool().unwrap_or(false);
                    let snippet = paper["abstract"]
                        .as_str()
                        .map(|s| {
                            // Truncate by CHARACTERS, not bytes — byte-slicing
                            // `&s[..277]` panics when byte 277 lands inside a
                            // multi-byte UTF-8 character (common in abstracts).
                            if s.chars().count() > 280 {
                                format!("{}…", s.chars().take(277).collect::<String>())
                            } else {
                                s.to_string()
                            }
                        })
                        .or_else(|| paper["journal"]["name"].as_str().map(str::to_string));
                    Some(evidence(
                        "semantic_scholar",
                        title,
                        year,
                        authors,
                        serde_json::json!({
                            "doi": doi,
                            "pmid": pmid,
                            "openAccessPdf": open_access_pdf,
                            "retracted": if is_retracted { "true" } else { "false" },
                        }),
                        url,
                        snippet,
                    ))
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(papers)
}
