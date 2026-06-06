//! Crossref DOI metadata enrichment. Provides citation counts, journal info,
//! and richer bibliographic metadata for papers that have a DOI.
//! Docs: https://api.crossref.org/swagger-ui/index.html
//! No API key required (rate limit: 50 req/s polite pool).

use crate::commands::medical::fetch_json;
use crate::error::{AppError, AppResult};
use url::Url;

#[derive(Debug, serde::Serialize)]
pub struct CrossrefMeta {
    pub doi: String,
    pub title: String,
    pub container_title: Option<String>,
    pub published_date: Option<String>,
    pub citation_count: Option<u64>,
    pub reference_count: Option<u64>,
    pub authors: Vec<String>,
    pub url: String,
}

/// Look up a DOI in Crossref and return enriched metadata.
/// 1-hour TTL — citation counts change slowly.
#[tauri::command]
pub async fn crossref_lookup(doi: String) -> AppResult<CrossrefMeta> {
    let mut url = Url::parse("https://api.crossref.org/works/")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    // Append DOI as a path segment so the url crate percent-encodes it correctly.
    url.path_segments_mut()
        .map_err(|_| AppError::InvalidInput("cannot modify url path".into()))?
        .push(&doi);

    let json = fetch_json(url, Some(3600)).await?;
    let msg = json
        .get("message")
        .ok_or_else(|| AppError::InvalidInput("crossref response missing message".into()))?;

    let title = msg["title"]
        .get(0)
        .and_then(|v| v.as_str())
        .or_else(|| msg["title"].as_str())
        .unwrap_or(&doi)
        .to_string();

    let container_title = msg["container-title"]
        .get(0)
        .and_then(|v| v.as_str())
        .map(str::to_string);

    let published_date = msg["published-print"]["date-parts"]
        .get(0)
        .and_then(|parts| {
            let y = parts.get(0)?.as_u64()?;
            let m = parts.get(1).and_then(|v| v.as_u64()).unwrap_or(1);
            let d = parts.get(2).and_then(|v| v.as_u64()).unwrap_or(1);
            Some(format!("{y}-{m:02}-{d:02}"))
        })
        .or_else(|| {
            msg["published-online"]["date-parts"]
                .get(0)
                .and_then(|parts| {
                    let y = parts.get(0)?.as_u64()?;
                    let m = parts.get(1).and_then(|v| v.as_u64()).unwrap_or(1);
                    let d = parts.get(2).and_then(|v| v.as_u64()).unwrap_or(1);
                    Some(format!("{y}-{m:02}-{d:02}"))
                })
        });

    let citation_count = msg["is-referenced-by-count"].as_u64();
    let reference_count = msg["references-count"].as_u64();

    let authors: Vec<String> = msg["author"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|a| {
                    let given = a["given"].as_str()?;
                    let family = a["family"].as_str()?;
                    Some(format!("{given} {family}"))
                })
                .take(8)
                .collect()
        })
        .unwrap_or_default();

    let url = msg["URL"]
        .as_str()
        .map(str::to_string)
        .unwrap_or_else(|| format!("https://doi.org/{doi}"));

    Ok(CrossrefMeta {
        doi: doi.clone(),
        title,
        container_title,
        published_date,
        citation_count,
        reference_count,
        authors,
        url,
    })
}
