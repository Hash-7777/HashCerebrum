//! Medical-source fetchers. Each module wraps one upstream API,
//! parses to a normalized shape, and writes provenance via audit.
//!
//! All implementations route through commands::net::net_get and inherit
//! its guard + audit guarantees.

pub mod ctgov;
pub mod europepmc;
pub mod openalex;
pub mod openfda;
pub mod pubmed;
pub mod rxnorm;

use crate::commands::net::net_get;
use crate::crypto::sha256_hex;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use url::Url;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceItem {
    pub source: String,
    pub title: String,
    pub year: Option<String>,
    pub authors: Vec<String>,
    pub identifiers: serde_json::Value,
    pub url: Option<String>,
    pub snippet: Option<String>,
    pub fetched_at: String,
    pub provenance_hash: String,
}

pub fn evidence(
    source: &str,
    title: String,
    year: Option<String>,
    authors: Vec<String>,
    identifiers: serde_json::Value,
    url: Option<String>,
    snippet: Option<String>,
) -> EvidenceItem {
    let fetched_at = chrono::Utc::now().to_rfc3339();
    let provenance_hash = sha256_hex(
        serde_json::json!({
            "source": source,
            "title": title,
            "year": year,
            "authors": authors,
            "identifiers": identifiers,
            "url": url,
            "snippet": snippet,
        })
        .to_string()
        .as_bytes(),
    );

    EvidenceItem {
        source: source.to_string(),
        title,
        year,
        authors,
        identifiers,
        url,
        snippet,
        fetched_at,
        provenance_hash,
    }
}

pub async fn fetch_json(mut url: Url) -> AppResult<serde_json::Value> {
    let response = net_get(url.to_string()).await?;
    if !(200..300).contains(&response.status) {
        url.set_query(None);
        return Err(AppError::Network(format!(
            "upstream returned HTTP {} for {}",
            response.status, url
        )));
    }
    Ok(serde_json::from_str(&response.body)?)
}

pub fn max_results(value: u32, fallback: u32, ceiling: u32) -> usize {
    let n = if value == 0 { fallback } else { value };
    n.min(ceiling).max(1) as usize
}
