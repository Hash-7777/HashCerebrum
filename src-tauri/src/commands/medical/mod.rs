//! Medical-source fetchers. Each module wraps one upstream API,
//! parses to a normalized shape, and writes provenance via audit.
//!
//! All implementations route through commands::net::net_get and inherit
//! its guard + audit guarantees.

pub mod clinvar;
pub mod crossref;
pub mod ctgov;
pub mod europepmc;
pub mod gwas_catalog;
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

// Bound an abstract to a character budget so a long full-text abstract cannot
// blow up the evidence block fed to the synthesis model. Counts by char (not
// byte) so a multibyte boundary is never split.
pub fn truncate_chars(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max_chars).collect();
    out.push('…');
    out
}

// Europe PMC's abstractText is served with structural HTML markup
// (<h4>Background</h4>, <b>, <i>, <sub>…). Strip the tags and decode a few
// common entities so the abstract reads as clean prose — otherwise the markup
// leaks into snippets, extracted key findings, tables, and the PDF.
pub fn strip_html(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            // Emit a space where each tag was so a block tag like </h4> cannot
            // weld the words on either side together ("Background</h4>We" must
            // not become "BackgroundWe"); the whitespace collapse below tidies
            // the extra spaces an inline tag leaves around a word.
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let decoded = out
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ");
    // Collapse the whitespace runs that removing block tags leaves behind.
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

// Exponential backoff between retry attempts: ~300ms, ~600ms. Keeps a
// transient upstream blip from instantly failing a specialist's source sweep
// without stalling the swarm for long.
async fn backoff_delay(attempt: u32) {
    let millis = 300u64 * (1u64 << (attempt.saturating_sub(1)).min(4));
    tokio::time::sleep(std::time::Duration::from_millis(millis)).await;
}

pub async fn fetch_json(url: Url, cache_ttl_seconds: Option<i64>) -> AppResult<serde_json::Value> {
    let cache_key = sha256_hex(url.as_str().as_bytes());

    // Check cache first. A cache read error must NOT abort the fetch — a
    // transient SQLite hiccup (e.g. a momentary lock under parallel agents)
    // would otherwise drop a whole source's evidence. Treat any read error as a
    // cache miss and fall through to the live network fetch.
    match cache::get(&cache_key) {
        Ok(Some(cached)) => {
            let mut log_url = url.clone();
            log_url.set_query(None);
            tracing::debug!(url = %log_url, "cache hit");
            return Ok(serde_json::from_slice(&cached)?);
        }
        Ok(None) => {}
        Err(e) => tracing::warn!(error = %e, "cache read failed; bypassing cache for this fetch"),
    }

    // Public biomedical endpoints (Europe PMC's EBI host especially) return
    // intermittent 503s and occasionally drop the connection mid-request.
    // These GETs are idempotent reads, so retry transient failures a few times
    // with exponential backoff before surfacing the error to the agent panel.
    // Retry lives here (not in net_get) so non-idempotent calls such as LLM
    // requests are never silently replayed.
    const MAX_ATTEMPTS: u32 = 3;
    let response = {
        let mut attempt = 0u32;
        loop {
            attempt += 1;
            match net_get(url.to_string()).await {
                Ok(resp) if (200..300).contains(&resp.status) => break resp,
                Ok(resp) => {
                    let transient = resp.status == 429 || (500..600).contains(&resp.status);
                    if transient && attempt < MAX_ATTEMPTS {
                        backoff_delay(attempt).await;
                        continue;
                    }
                    let mut log_url = url.clone();
                    log_url.set_query(None);
                    // Also drop any user:pass@ userinfo so credentials can never
                    // ride along in an error surfaced over IPC.
                    let _ = log_url.set_username("");
                    let _ = log_url.set_password(None);
                    return Err(AppError::Network(format!(
                        "upstream returned HTTP {} for {}",
                        resp.status, log_url
                    )));
                }
                Err(e) => {
                    if attempt < MAX_ATTEMPTS && matches!(e, AppError::Network(_)) {
                        backoff_delay(attempt).await;
                        continue;
                    }
                    return Err(e);
                }
            }
        }
    };

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

/// Extract a dbSNP rsID (e.g. "rs1051792") from a free-text genetics query, if
/// one is present. Lets the genetic-database sources look a variant up directly
/// rather than via its gene.
pub(super) fn rs_id(query: &str) -> Option<String> {
    query
        .split(|c: char| !c.is_ascii_alphanumeric())
        .map(str::to_ascii_lowercase)
        .find(|tok| {
            tok.len() >= 3 && tok.starts_with("rs") && tok[2..].chars().all(|c| c.is_ascii_digit())
        })
}

/// Best-effort gene-symbol guess from a free-text query. Gene symbols are short
/// upper-case tokens (MICA, TP53, BRCA1, HLA-DRB1) — pick the first token that
/// looks like one. Heuristic only; the literature agents do not depend on it.
pub(super) fn gene_symbol(query: &str) -> Option<String> {
    query
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .map(|t| t.trim_matches('-'))
        .find(|t| {
            let len = t.chars().count();
            (2..=12).contains(&len)
                && t.chars().any(|c| c.is_ascii_uppercase())
                && t.chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-')
                && t.chars().any(|c| c.is_ascii_alphabetic())
        })
        .map(|t| t.to_string())
}

/// Genetics meta-words that describe the *kind* of finding, not the disease, so
/// they must not leak into a disease/trait filter ("MICA gene and diabetes" →
/// the disease is "diabetes", not "gene").
const GENETICS_META_WORDS: &[&str] = &[
    "gene", "genes", "variant", "variants", "polymorphism", "polymorphisms", "mutation",
    "mutations", "allele", "alleles", "genotype", "genotypes", "association", "associations",
    "snp", "snps", "variation", "variations", "correlation", "correlations",
];

/// Disease/condition terms from a genetics query — lowercased, excluding the
/// gene symbol, genetics meta-words and generic stop words. Shared by the
/// genetic-database sources to keep results on the user's actual disease.
pub(super) fn disease_terms(query: &str, gene: Option<&str>) -> Vec<String> {
    query
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .map(|t| t.trim_matches('-').to_lowercase())
        .filter(|t| {
            t.chars().count() >= 4
                && t.chars().any(|c| c.is_alphabetic())
                && gene.map(|g| !t.eq_ignore_ascii_case(g)).unwrap_or(true)
                && !GENETICS_META_WORDS.contains(&t.as_str())
                && !QUERY_STOP_WORDS.contains(&t.as_str())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_html_removes_tags_and_collapses_whitespace() {
        let input = "<h4>Background</h4>We compared <b>543</b> cases\n  with 3,272 controls (OR&nbsp;1.20).";
        assert_eq!(
            strip_html(input),
            "Background We compared 543 cases with 3,272 controls (OR 1.20)."
        );
    }

    #[test]
    fn strip_html_leaves_plain_text_unchanged() {
        assert_eq!(
            strip_html("A plain abstract with no markup."),
            "A plain abstract with no markup."
        );
    }

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

    #[test]
    fn rs_id_is_extracted_when_present() {
        assert_eq!(
            rs_id("association of rs1051792 with diabetes"),
            Some("rs1051792".to_string())
        );
        assert_eq!(rs_id("MICA TT genotype and diabetes"), None);
    }

    #[test]
    fn gene_symbol_picks_the_uppercase_token() {
        assert_eq!(
            gene_symbol("MICA polymorphism and cardiovascular disease"),
            Some("MICA".to_string())
        );
        assert_eq!(gene_symbol("BRCA1 and breast cancer risk"), Some("BRCA1".to_string()));
        // No uppercase gene-like token → None (lowercase prose is not a symbol).
        assert_eq!(gene_symbol("does the variant affect diabetes"), None);
    }
}
