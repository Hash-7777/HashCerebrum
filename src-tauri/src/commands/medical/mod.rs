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
pub mod semantic_scholar;

use crate::cache;
use crate::commands::net::net_get;
use crate::crypto::sha256_hex;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use url::Url;

const QUERY_STOP_WORDS: &[&str] = &[
    "a",
    "about",
    "after",
    "all",
    "also",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "between",
    "by",
    "clinical",
    "database",
    "databases",
    "do",
    "does",
    "during",
    "evidence",
    "find",
    "for",
    "from",
    "how",
    "in",
    "include",
    "including",
    "into",
    "is",
    "of",
    "on",
    "or",
    "patient",
    "patients",
    "pharmacology",
    "public",
    "query",
    "record",
    "records",
    "research",
    "review",
    "search",
    "source",
    "sources",
    "studies",
    "study",
    "the",
    "these",
    "this",
    "to",
    "trial",
    "trials",
    "using",
    "what",
    "when",
    "where",
    "with",
];

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

pub async fn fetch_json(
    mut url: Url,
    cache_ttl_seconds: Option<i64>,
) -> AppResult<serde_json::Value> {
    let cache_key = sha256_hex(url.as_str().as_bytes());

    // Check cache first
    if let Some(cached) = cache::get(&cache_key)? {
        let mut log_url = url.clone();
        log_url.set_query(None);
        tracing::debug!(url = %log_url, "cache hit");
        return Ok(serde_json::from_slice(&cached)?);
    }

    let response = net_get(url.to_string()).await?;
    if !(200..300).contains(&response.status) {
        url.set_query(None);
        return Err(AppError::Network(format!(
            "upstream returned HTTP {} for {}",
            response.status, url
        )));
    }

    // Write to cache if TTL is specified
    if let Some(ttl) = cache_ttl_seconds {
        let host = url.host_str().unwrap_or("unknown").to_string();
        if let Err(e) = cache::set(&cache_key, &host, response.body.as_bytes(), ttl) {
            tracing::warn!(error = %e, "cache write failed");
        }
    }

    Ok(serde_json::from_str(&response.body)?)
}

pub fn max_results(value: u32, fallback: u32, ceiling: u32) -> usize {
    let n = if value == 0 { fallback } else { value };
    n.min(ceiling).max(1) as usize
}

fn nct_id(query: &str) -> Option<String> {
    query
        .split(|c: char| !c.is_ascii_alphanumeric())
        .map(str::to_ascii_uppercase)
        .find(|token| {
            token.len() == 11
                && token.starts_with("NCT")
                && token[3..].chars().all(|c| c.is_ascii_digit())
        })
}

pub(super) fn compact_query_terms(query: &str, max_terms: usize) -> Vec<String> {
    if let Some(id) = nct_id(query) {
        return vec![id];
    }

    let mut seen = HashSet::new();
    let mut terms = Vec::new();

    for raw in query.split(|c: char| !(c.is_alphanumeric() || c == '-')) {
        let word = raw.trim_matches('-');
        if word.chars().count() < 2 || !word.chars().any(char::is_alphabetic) {
            continue;
        }

        let key = word.to_lowercase();
        if QUERY_STOP_WORDS.contains(&key.as_str()) || !seen.insert(key) {
            continue;
        }

        terms.push(word.to_string());
        if terms.len() >= max_terms {
            break;
        }
    }

    terms
}

pub(super) fn compact_query(query: &str, max_terms: usize) -> String {
    compact_query_terms(query, max_terms).join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_query_terms_keep_search_simple_for_upstreams() {
        let terms = compact_query_terms(
            "What are the risks of warfarin and amiodarone interaction in elderly patients with atrial fibrillation clinical trial safety bleeding registry pharmacology public health?",
            8,
        );

        assert_eq!(
            terms,
            [
                "risks",
                "warfarin",
                "amiodarone",
                "interaction",
                "elderly",
                "atrial",
                "fibrillation",
                "safety"
            ]
        );
    }

    #[test]
    fn compact_query_terms_preserve_nct_ids() {
        assert_eq!(
            compact_query_terms("Please retrieve trial nct01234567 details", 8),
            ["NCT01234567"]
        );
    }
}
