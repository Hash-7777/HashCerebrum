//! GWAS Catalog (EBI) — curated gene/variant ↔ trait associations with effect
//! sizes (odds ratio / beta), 95% CI, and p-value. The quantitative backbone of
//! the Genetics mode's association scoring.
//! Docs: https://www.ebi.ac.uk/gwas/rest/docs/api
//!
//! Flow: an rsID in the query is looked up directly; otherwise the gene symbol
//! resolves to its SNPs (findByGene) and each SNP's associations are fetched.
//! Bounded by small caps so a run stays light enough for free/local tiers.

use crate::commands::medical::{
    disease_terms, evidence, fetch_json, gene_symbol, max_results as clamp, rs_id, EvidenceItem,
};
use crate::error::AppResult;
use url::Url;

const API: &str = "https://www.ebi.ac.uk/gwas/rest/api";
const MAX_SNPS: usize = 6;
const CACHE_TTL: i64 = 86_400;

/// Parse the rsIDs a gene maps to (findByGene response). Pure.
pub(crate) fn parse_snp_ids(json: &serde_json::Value) -> Vec<String> {
    json.pointer("/_embedded/singleNucleotidePolymorphisms")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s["rsId"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

fn fmt_p(assoc: &serde_json::Value) -> Option<String> {
    if let Some(p) = assoc["pvalue"].as_f64() {
        return Some(format!("{p:.1e}"));
    }
    let mantissa = assoc["pvalueMantissa"].as_i64()?;
    let exponent = assoc["pvalueExponent"].as_i64()?;
    Some(format!("{mantissa}e{exponent}"))
}

/// Build citable EvidenceItems from a SNP's associations response. Pure: every
/// field is copied from the record — odds ratio, beta, CI range and p-value go
/// into both a human/extractor-friendly snippet and the structured identifiers
/// the association-confidence engine reads. `gene` annotates the title.
pub(crate) fn parse_associations(
    json: &serde_json::Value,
    gene: Option<&str>,
    disease: &[String],
) -> Vec<EvidenceItem> {
    let Some(assocs) = json
        .pointer("/_embedded/associations")
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };

    let mut out = Vec::new();
    for assoc in assocs {
        let traits: Vec<String> = assoc["efoTraits"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|t| t["trait"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let trait_label = traits.join("; ");
        let trait_lc = trait_label.to_lowercase();
        // Keep only associations whose trait matches a disease term (when given).
        if !disease.is_empty() && !disease.iter().any(|d| trait_lc.contains(d)) {
            continue;
        }
        let rsid = assoc
            .pointer("/snps/0/rsId")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown variant")
            .to_string();

        let or = assoc["orPerCopyNum"].as_f64();
        let beta = assoc["betaNum"].as_f64();
        let beta_unit = assoc["betaUnit"].as_str().unwrap_or("");
        let beta_dir = assoc["betaDirection"].as_str().unwrap_or("");
        let ci = assoc["range"].as_str().filter(|s| !s.is_empty());
        let p = fmt_p(assoc);

        // Human + extractor-friendly snippet (uses "odds ratio" / "95% CI" so the
        // shared numeric extractor reads it). Structured numbers also kept below.
        let mut parts = vec![format!("GWAS Catalog association with {}.", if trait_label.is_empty() { "an unspecified trait" } else { &trait_label })];
        if let Some(or) = or {
            let ci_txt = ci.map(|c| format!(" (95% CI {})", c.trim_matches(['[', ']']))).unwrap_or_default();
            parts.push(format!("Odds ratio {or}{ci_txt}."));
        } else if let Some(beta) = beta {
            parts.push(format!("Beta {beta} {beta_unit} {beta_dir}.").replace("  ", " "));
        }
        if let Some(p) = &p {
            parts.push(format!("p={p}."));
        }
        let snippet = parts.join(" ");

        let title = if let Some(g) = gene {
            format!("{} association at {rsid} ({g})", if trait_label.is_empty() { "Trait".into() } else { trait_label.clone() })
        } else {
            format!("{} association at {rsid}", if trait_label.is_empty() { "Trait".into() } else { trait_label.clone() })
        };

        let identifiers = serde_json::json!({
            "rsId": rsid,
            "trait": trait_label,
            "oddsRatio": or,
            "beta": beta,
            "ci": ci,
            "pValue": assoc["pvalue"].as_f64(),
        });

        out.push(evidence(
            "gwas_catalog",
            title,
            None,
            Vec::new(),
            identifiers,
            Some(format!("https://www.ebi.ac.uk/gwas/variants/{rsid}")),
            Some(snippet),
        ));
    }
    out
}

async fn associations_for(rsid: &str) -> Option<serde_json::Value> {
    let url = Url::parse(&format!(
        "{API}/singleNucleotidePolymorphisms/{rsid}/associations?projection=associationBySnp"
    ))
    .ok()?;
    fetch_json(url, Some(CACHE_TTL)).await.ok()
}

#[tauri::command]
pub async fn gwas_catalog_search(query: String, max_results: u32) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp(max_results, 12, 40);
    let gene = gene_symbol(&query);
    let disease = disease_terms(&query, gene.as_deref());

    // Resolve which SNPs to inspect: a direct rsID, else the gene's SNPs.
    let snp_ids: Vec<String> = if let Some(rs) = rs_id(&query) {
        vec![rs]
    } else if let Some(g) = &gene {
        let url = Url::parse(&format!(
            "{API}/singleNucleotidePolymorphisms/search/findByGene?geneName={g}"
        ))
        .map_err(|e| crate::error::AppError::InvalidInput(e.to_string()))?;
        match fetch_json(url, Some(CACHE_TTL)).await {
            Ok(json) => parse_snp_ids(&json).into_iter().take(MAX_SNPS).collect(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    let mut out: Vec<EvidenceItem> = Vec::new();
    for rsid in snp_ids {
        if out.len() >= limit {
            break;
        }
        if let Some(json) = associations_for(&rsid).await {
            out.extend(parse_associations(&json, gene.as_deref(), &disease));
        }
    }
    out.truncate(limit);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_snp_ids_from_find_by_gene() {
        let json = serde_json::json!({
            "_embedded": { "singleNucleotidePolymorphisms": [
                { "rsId": "rs2853977" }, { "rsId": "rs1051792" }
            ]}
        });
        assert_eq!(parse_snp_ids(&json), ["rs2853977", "rs1051792"]);
    }

    #[test]
    fn parses_association_with_or_ci_and_pvalue() {
        let json = serde_json::json!({
            "_embedded": { "associations": [{
                "pvalue": 3.0e-6,
                "orPerCopyNum": 1.42,
                "betaNum": null,
                "range": "[1.10-1.84]",
                "efoTraits": [{ "trait": "type 1 diabetes mellitus" }],
                "snps": [{ "rsId": "rs1051792" }]
            }]}
        });
        let items = parse_associations(&json, Some("MICA"), &[]);
        assert_eq!(items.len(), 1);
        let item = &items[0];
        assert_eq!(item.source, "gwas_catalog");
        assert!(item.title.contains("rs1051792"));
        assert!(item.title.contains("MICA"));
        let snip = item.snippet.as_deref().unwrap();
        assert!(snip.contains("Odds ratio 1.42"));
        assert!(snip.contains("95% CI 1.10-1.84"));
        assert_eq!(item.identifiers["oddsRatio"].as_f64(), Some(1.42));
        assert_eq!(item.identifiers["pValue"].as_f64(), Some(3.0e-6));
    }

    #[test]
    fn filters_associations_by_disease_term() {
        let json = serde_json::json!({
            "_embedded": { "associations": [
                { "efoTraits": [{ "trait": "type 1 diabetes mellitus" }], "snps": [{ "rsId": "rs1" }], "orPerCopyNum": 2.0 },
                { "efoTraits": [{ "trait": "psoriasis" }], "snps": [{ "rsId": "rs2" }], "orPerCopyNum": 1.5 }
            ]}
        });
        let items = parse_associations(&json, Some("MICA"), &["diabetes".to_string()]);
        assert_eq!(items.len(), 1);
        assert!(items[0].title.contains("rs1"));
    }
}
