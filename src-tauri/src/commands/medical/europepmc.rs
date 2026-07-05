//! Europe PMC. Docs: https://europepmc.org/RestfulWebService

use crate::commands::medical::{
    evidence, fetch_json, fetch_text, max_results as clamp_max_results, strip_html, truncate_chars,
    EvidenceItem,
};
use crate::error::{AppError, AppResult};
use url::Url;

/// Upper bound on the plain-text length returned from a full-text article, so a
/// very long paper cannot blow up memory or the downstream embedding budget.
const FULLTEXT_MAX_CHARS: usize = 200_000;

/// Fetch the open-access full text of an article from Europe PMC and return it as
/// plain text (tags stripped). `source` is Europe PMC's source code (e.g. "PMC"
/// with a PMCID, or "MED" with a PMID) and `id` the corresponding identifier.
///
/// Only open-access articles have full text here; for everything else Europe PMC
/// returns a non-200, which surfaces as an error the caller treats as "no full
/// text" and falls back to the abstract. So this only ever ADDS depth.
#[tauri::command]
pub async fn europepmc_fulltext(source: String, id: String) -> AppResult<String> {
    let src = source.trim().to_ascii_uppercase();
    let ident = id.trim();
    if ident.is_empty() || src.is_empty() {
        return Err(AppError::InvalidInput(
            "empty full-text source or id".into(),
        ));
    }
    // Path segments are validated (alphanumerics only) so nothing can traverse or
    // inject into the URL path.
    if !src.chars().all(|c| c.is_ascii_alphanumeric())
        || !ident.chars().all(|c| c.is_ascii_alphanumeric())
    {
        return Err(AppError::InvalidInput(
            "invalid full-text identifier".into(),
        ));
    }
    let url = Url::parse(&format!(
        "https://www.ebi.ac.uk/europepmc/webservices/rest/{src}/{ident}/fullTextXML"
    ))
    .map_err(|e| AppError::InvalidInput(e.to_string()))?;

    // Full text does not change, so cache it for a week.
    let xml = fetch_text(url, Some(604_800)).await?;

    // Extract the <body>…</body> (the article text) when present, dropping the
    // front matter and reference list; otherwise strip the whole document.
    let body = extract_body(&xml);
    let text = truncate_chars(&strip_html(body), FULLTEXT_MAX_CHARS);
    if text.trim().is_empty() {
        return Err(AppError::Network("no full text available".into()));
    }
    Ok(text)
}

/// Return the inner text of the first `<body>…</body>` element, or the whole input
/// when there is none.
fn extract_body(xml: &str) -> &str {
    let lower = xml.to_ascii_lowercase();
    if let Some(start) = lower.find("<body") {
        // Move past the opening tag's '>'.
        if let Some(gt) = xml[start..].find('>') {
            let content_start = start + gt + 1;
            if let Some(end_rel) = lower[content_start..].find("</body>") {
                return &xml[content_start..content_start + end_rel];
            }
            return &xml[content_start..];
        }
    }
    xml
}

#[cfg(test)]
mod tests {
    use super::extract_body;

    #[test]
    fn extracts_inner_body_dropping_front_and_back_matter() {
        let xml = "<article><front>meta</front><body><sec><p>Real text.</p></sec></body><back>refs</back></article>";
        assert_eq!(extract_body(xml), "<sec><p>Real text.</p></sec>");
    }

    #[test]
    fn handles_body_tag_with_attributes() {
        let xml = "<article><body id=\"b1\"><p>Hi</p></body></article>";
        assert_eq!(extract_body(xml), "<p>Hi</p>");
    }

    #[test]
    fn falls_back_to_whole_input_without_a_body() {
        let xml = "<article><p>No body element here.</p></article>";
        assert_eq!(extract_body(xml), xml);
    }
}

#[tauri::command]
pub async fn europepmc_fetch(
    query: String,
    max_results: Option<u32>,
) -> AppResult<Vec<EvidenceItem>> {
    let limit = clamp_max_results(max_results.unwrap_or(12), 12, 40);
    let mut url = Url::parse("https://www.ebi.ac.uk/europepmc/webservices/rest/search")
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    url.query_pairs_mut()
        .append_pair("query", &query)
        .append_pair("format", "json")
        // `core` adds abstractText (and full metadata) — without it the search
        // returns only titles/journals, starving downstream extraction.
        .append_pair("resultType", "core")
        .append_pair("pageSize", &limit.to_string());
    let json = fetch_json(url, Some(86400)).await?;
    let results = json
        .pointer("/resultList/result")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(results
        .into_iter()
        .map(|item| {
            let title = item["title"]
                .as_str()
                .unwrap_or("Untitled Europe PMC record")
                .to_string();
            let year = item["pubYear"].as_str().map(str::to_string);
            let authors = item["authorString"]
                .as_str()
                .map(|s| {
                    s.split(',')
                        .map(|a| a.trim().trim_end_matches('.').to_string())
                        .filter(|a| !a.is_empty())
                        .take(8)
                        .collect()
                })
                .unwrap_or_default();
            let pmid = item["pmid"].as_str().map(str::to_string);
            let doi = item["doi"].as_str().map(str::to_string);
            // pmcid + open-access flag let the frontend fetch the full text of the
            // articles that actually have it (europepmc_fulltext with source "PMC").
            let pmcid = item["pmcid"].as_str().map(str::to_string);
            let is_open_access = item["isOpenAccess"].as_str();
            let url = item["pmid"]
                .as_str()
                .map(|id| format!("https://europepmc.org/article/MED/{id}"));
            // Prefer the abstract; fall back to the journal name when Europe PMC
            // has no abstract for the record.
            let snippet = item["abstractText"]
                .as_str()
                .map(|s| truncate_chars(&strip_html(s), 2000))
                .filter(|s| !s.is_empty())
                .or_else(|| item["journalTitle"].as_str().map(str::to_string));
            {
                let mut ev = evidence(
                    "europepmc",
                    title,
                    year,
                    authors,
                    serde_json::json!({ "pmid": pmid, "doi": doi, "pmcid": pmcid, "isOpenAccess": is_open_access, "source": item["source"].as_str(), "journal": item["journalTitle"].as_str() }),
                    url,
                    snippet,
                );
                ev.volume = item["journalVolume"].as_str().map(str::to_string);
                ev.issue = item["issue"].as_str().map(str::to_string);
                ev.pages = item["pageInfo"].as_str().map(str::to_string);
                ev
            }
        })
        .collect())
}
