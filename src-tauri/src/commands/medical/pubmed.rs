//! PubMed via NCBI E-utilities.
//! Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/

use crate::commands::medical::{
    evidence, fetch_json, max_results as clamp_max_results, strip_html, truncate_chars,
    EvidenceItem,
};
use crate::error::{AppError, AppResult};
use std::collections::HashMap;
use url::Url;

/// Abstract text is the fuel for evidence extraction (sample sizes, effect
/// estimates, populations). NCBI's esummary returns only metadata, and its
/// abstract endpoint (efetch) is XML-only — so we enrich PubMed hits with
/// abstracts from Europe PMC, which mirrors PubMed (SRC:MED) and serves
/// `abstractText` as JSON. One batched lookup covers every PMID in the page.
const ABSTRACT_CHAR_CAP: usize = 3000;

async fn pubmed_abstracts(pmids: &[String]) -> HashMap<String, String> {
    if pmids.is_empty() {
        return HashMap::new();
    }
    let ext_ids = pmids
        .iter()
        .map(|id| format!("EXT_ID:{id}"))
        .collect::<Vec<_>>()
        .join(" OR ");
    let Ok(mut url) = Url::parse("https://www.ebi.ac.uk/europepmc/webservices/rest/search") else {
        return HashMap::new();
    };
    url.query_pairs_mut()
        .append_pair("query", &format!("({ext_ids}) AND SRC:MED"))
        .append_pair("resultType", "core")
        .append_pair("format", "json")
        .append_pair("pageSize", &pmids.len().to_string());
    // A failed enrichment must never fail the search — fall back to metadata.
    let Ok(json) = fetch_json(url, Some(86400)).await else {
        return HashMap::new();
    };
    let mut map = HashMap::new();
    if let Some(results) = json
        .pointer("/resultList/result")
        .and_then(|v| v.as_array())
    {
        for item in results {
            let pmid = item["pmid"].as_str();
            let abstract_text = item["abstractText"].as_str();
            if let (Some(pmid), Some(text)) = (pmid, abstract_text) {
                let cleaned = strip_html(text);
                if !cleaned.is_empty() {
                    map.insert(
                        pmid.to_string(),
                        truncate_chars(&cleaned, ABSTRACT_CHAR_CAP),
                    );
                }
            }
        }
    }
    map
}

#[tauri::command]
pub async fn pubmed_search(query: String, max_results: u32) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results, 12, 40);
    let mut search_url = Url::parse("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    search_url
        .query_pairs_mut()
        .append_pair("db", "pubmed")
        .append_pair("retmode", "json")
        .append_pair("retmax", &limit.to_string())
        // Rank by relevance, not PubMed's default "most recent" — otherwise a
        // broad term returns the newest loosely-matching papers (off-topic
        // recent records) instead of the best matches for the query.
        .append_pair("sort", "relevance")
        .append_pair("term", &query);
    let search = fetch_json(search_url, Some(86400)).await?;
    let ids: Vec<String> = search
        .pointer("/esearchresult/idlist")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut summary_url = Url::parse("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    summary_url
        .query_pairs_mut()
        .append_pair("db", "pubmed")
        .append_pair("retmode", "json")
        .append_pair("id", &ids.join(","));
    let summary = fetch_json(summary_url, Some(86400)).await?;
    // Enrich with real abstracts so downstream extraction has populations,
    // sample sizes, and effect estimates to read — not just a journal name.
    let abstracts = pubmed_abstracts(&ids).await;
    let mut out = Vec::new();
    for id in ids {
        let item = &summary["result"][&id];
        let title = item["title"]
            .as_str()
            .unwrap_or("Untitled PubMed record")
            .to_string();
        let year = item["pubdate"]
            .as_str()
            .and_then(|s| s.get(0..4))
            .map(str::to_string);
        let authors = item["authors"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|a| a["name"].as_str().map(str::to_string))
                    .take(8)
                    .collect()
            })
            .unwrap_or_default();
        let url = Some(format!("https://pubmed.ncbi.nlm.nih.gov/{id}/"));
        // Prefer the abstract; fall back to the journal name when no abstract
        // was indexed for this record.
        let snippet = abstracts
            .get(&id)
            .cloned()
            .or_else(|| item["fulljournalname"].as_str().map(str::to_string));
        out.push(evidence(
            "pubmed",
            title,
            year,
            authors,
            serde_json::json!({
                "pmid": id,
                "doi": item["elocationid"].as_str(),
                "journal": item["fulljournalname"].as_str(),
            }),
            url,
            snippet,
        ));
    }
    Ok(out)
}
