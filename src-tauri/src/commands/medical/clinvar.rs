//! ClinVar via NCBI E-utilities — variant clinical significance and the
//! conditions a variant is classified against. Complements GWAS Catalog (which
//! carries the quantitative association) with curated clinical interpretation.
//! Docs: https://www.ncbi.nlm.nih.gov/books/NBK25501/
//!
//! Keyless. An optional NCBI API key would only raise the rate limit.

use crate::commands::medical::{
    compact_query, disease_terms, evidence, fetch_json, gene_symbol, max_results as clamp, rs_id,
    EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

const CACHE_TTL: i64 = 86_400;

/// Build the ClinVar query term from free text: a direct rsID, else
/// `GENE[gene] AND <disease terms>`, else the compacted free text.
pub(crate) fn build_term(query: &str) -> String {
    if let Some(rs) = rs_id(query) {
        return rs;
    }
    if let Some(gene) = gene_symbol(query) {
        let disease: Vec<String> = disease_terms(query, Some(&gene))
            .into_iter()
            .take(4)
            .collect();
        if disease.is_empty() {
            return format!("{gene}[gene]");
        }
        return format!("{gene}[gene] AND {}", disease.join(" "));
    }
    compact_query(query, 6)
}

fn traits_of(item: &serde_json::Value) -> Vec<String> {
    item.pointer("/germline_classification/trait_set")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t["trait_name"].as_str().map(str::to_string))
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Turn an esummary response into citable EvidenceItems. Pure.
pub(crate) fn parse_summaries(json: &serde_json::Value) -> Vec<EvidenceItem> {
    let Some(uids) = json.pointer("/result/uids").and_then(|v| v.as_array()) else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for uid in uids.iter().filter_map(|v| v.as_str()) {
        let item = &json["result"][uid];
        if item.is_null() {
            continue;
        }
        let title = item["title"]
            .as_str()
            .unwrap_or("Untitled ClinVar record")
            .to_string();
        let significance = item
            .pointer("/germline_classification/description")
            .and_then(|v| v.as_str())
            .unwrap_or("not provided");
        let variant_type = item["obj_type"]
            .as_str()
            .or_else(|| item["variant_type"].as_str())
            .unwrap_or("variant");
        let traits = traits_of(item);
        let year = item
            .pointer("/germline_classification/last_evaluated")
            .and_then(|v| v.as_str())
            .and_then(|s| s.get(0..4))
            .map(str::to_string);
        let accession = item["accession"].as_str().unwrap_or("").to_string();

        let condition = if traits.is_empty() {
            "the submitted condition".to_string()
        } else {
            traits.join("; ")
        };
        let snippet = format!(
            "ClinVar clinical significance: {significance} for {condition}. Variant type: {variant_type}."
        );

        // EvidenceItem.identifiers is a string map on the TS side; the trait
        // list lives in the snippet, so only string IDs go here.
        let identifiers = serde_json::json!({
            "accession": accession,
            "clinvarId": uid,
            "clinicalSignificance": significance,
        });

        out.push(evidence(
            "clinvar",
            title,
            year,
            Vec::new(),
            identifiers,
            Some(format!(
                "https://www.ncbi.nlm.nih.gov/clinvar/variation/{uid}/"
            )),
            Some(snippet),
        ));
    }
    out
}

#[tauri::command]
pub async fn clinvar_search(query: String, max_results: u32) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp(max_results, 12, 40);
    let term = build_term(&query);

    let mut search_url = Url::parse("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    search_url
        .query_pairs_mut()
        .append_pair("db", "clinvar")
        .append_pair("retmode", "json")
        .append_pair("retmax", &limit.to_string())
        .append_pair("term", &term);
    let search = fetch_json(search_url, Some(CACHE_TTL)).await?;
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
        .append_pair("db", "clinvar")
        .append_pair("retmode", "json")
        .append_pair("id", &ids.join(","));
    let summary = fetch_json(summary_url, Some(CACHE_TTL)).await?;
    Ok(parse_summaries(&summary))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_term_uses_rsid_directly() {
        assert_eq!(build_term("does rs1051792 cause diabetes"), "rs1051792");
    }

    #[test]
    fn build_term_combines_gene_and_disease() {
        assert_eq!(
            build_term("MICA gene and cardiovascular complications"),
            "MICA[gene] AND cardiovascular complications"
        );
    }

    #[test]
    fn build_term_gene_only_when_no_disease() {
        assert_eq!(build_term("MICA"), "MICA[gene]");
    }

    #[test]
    fn parses_clinvar_summary() {
        let json = serde_json::json!({
            "result": {
                "uids": ["157007"],
                "157007": {
                    "accession": "VCV000157007",
                    "obj_type": "single nucleotide variant",
                    "title": "NM_000247.3(MICA):c.454G>A",
                    "germline_classification": {
                        "description": "Likely pathogenic",
                        "last_evaluated": "2025/04/30 00:00",
                        "trait_set": [{ "trait_name": "Type 1 diabetes mellitus" }]
                    }
                }
            }
        });
        let items = parse_summaries(&json);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.source, "clinvar");
        assert_eq!(item.year.as_deref(), Some("2025"));
        let snip = item.snippet.as_deref().unwrap();
        assert!(snip.contains("Likely pathogenic"));
        assert!(snip.contains("Type 1 diabetes mellitus"));
        assert_eq!(
            item.identifiers["clinicalSignificance"].as_str(),
            Some("Likely pathogenic")
        );
        assert_eq!(item.identifiers["accession"].as_str(), Some("VCV000157007"));
    }
}
