//! OpenAlex. Docs: https://docs.openalex.org/

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, truncate_chars, EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

/// OpenAlex serves abstracts as an inverted index ({word: [positions]}) to
/// sidestep publisher copyright on the contiguous text. Rebuild the prose by
/// placing each token at its positions, so downstream extraction has real
/// abstract text to read instead of only the journal name.
fn abstract_from_inverted_index(value: &serde_json::Value) -> Option<String> {
    let map = value.as_object()?;
    if map.is_empty() {
        return None;
    }
    let mut tokens: Vec<(u64, &str)> = Vec::new();
    for (word, positions) in map {
        if let Some(arr) = positions.as_array() {
            for pos in arr {
                if let Some(p) = pos.as_u64() {
                    tokens.push((p, word.as_str()));
                }
            }
        }
    }
    if tokens.is_empty() {
        return None;
    }
    tokens.sort_by_key(|(pos, _)| *pos);
    let text = tokens
        .into_iter()
        .map(|(_, word)| word)
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(truncate_chars(trimmed, 2000))
    }
}

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
    let json = fetch_json(url, Some(21600)).await?;
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
            // Prefer the reconstructed abstract; fall back to the journal name.
            let snippet =
                abstract_from_inverted_index(&item["abstract_inverted_index"]).or_else(|| {
                    item["primary_location"]["source"]["display_name"]
                        .as_str()
                        .map(str::to_string)
                });
            evidence(
                "openalex",
                title,
                item["publication_year"].as_i64().map(|y| y.to_string()),
                authors,
                serde_json::json!({ "openalex": item["id"].as_str(), "doi": item["doi"].as_str() }),
                item["id"].as_str().map(str::to_string),
                snippet,
            )
        })
        .collect())
}
