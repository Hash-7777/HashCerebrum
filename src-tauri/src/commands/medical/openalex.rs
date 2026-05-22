//! OpenAlex. Docs: https://docs.openalex.org/

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

#[tauri::command]
pub async fn openalex_query(
    query: String,
    max_results: Option<u32>,
) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(8), 8, 20);
    let mut url = Url::parse("https://api.openalex.org/works")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("search", &query)
        .append_pair("per-page", &limit.to_string());
    let json = fetch_json(url).await?;
    let results = json["results"].as_array().cloned().unwrap_or_default();
    Ok(results
        .into_iter()
        .map(|item| {
            let title = item["display_name"]
                .as_str()
                .unwrap_or("Untitled OpenAlex work")
                .to_string();
            let authors = item["authorships"]
                .as_array()
                .map(|arr| {
                    arr.iter()
                        .filter_map(|a| {
                            a.pointer("/author/display_name")
                                .and_then(|v| v.as_str())
                                .map(str::to_string)
                        })
                        .take(8)
                        .collect()
                })
                .unwrap_or_default();
            evidence(
                "openalex",
                title,
                item["publication_year"].as_i64().map(|y| y.to_string()),
                authors,
                serde_json::json!({ "openalex": item["id"].as_str(), "doi": item["doi"].as_str() }),
                item["id"].as_str().map(str::to_string),
                item["primary_location"]["source"]["display_name"]
                    .as_str()
                    .map(str::to_string),
            )
        })
        .collect())
}
