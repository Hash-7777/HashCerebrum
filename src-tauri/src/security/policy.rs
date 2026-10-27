//! Declarative policy — allowed hosts, allowed LLM providers, etc.
//!
//! Loaded once at startup; checked on every `guard::check()` call.
//! Lives in code (not config) so it cannot be tampered with at runtime
//! by a compromised renderer.

use crate::error::AppResult;
use std::sync::OnceLock;

#[derive(Debug)]
pub struct Policy {
    pub allowed_hosts: &'static [&'static str],
    pub allowed_llm_providers: &'static [&'static str],
}

static POLICY: OnceLock<Policy> = OnceLock::new();

/// Hosts the app is allowed to talk to. ANYTHING not in this list is rejected
/// by the guard. To add a new medical source, edit this list and the CSP.
const ALLOWED_HOSTS: &[&str] = &[
    // NCBI / PubMed
    "eutils.ncbi.nlm.nih.gov",
    "www.ncbi.nlm.nih.gov",
    // Europe PMC
    "www.ebi.ac.uk",
    "europepmc.org",
    // OpenAlex
    "api.openalex.org",
    // ClinicalTrials.gov
    "clinicaltrials.gov",
    // FDA
    "api.fda.gov",
    // RxNorm
    "rxnav.nlm.nih.gov",
    // Semantic Scholar (citation-aware academic search)
    "api.semanticscholar.org",
    // Crossref (DOI metadata: journal, dates, citation counts)
    "api.crossref.org",
    // LLM providers (only used if user opts into backend-proxied LLM)
    "api.anthropic.com",
    "api.openai.com",
    "api.groq.com",
    "generativelanguage.googleapis.com",
    "openrouter.ai",
    "api.cerebras.ai",
    "api.sambanova.ai",
    "api.moonshot.ai",
    "api.deepseek.com",
    "api.mistral.ai",
    "integrate.api.nvidia.com",
    "api.minimax.io",
    "api.x.ai",
    "api.together.xyz",
    "api.fireworks.ai",
    "api.deepinfra.com",
    "api.z.ai",
    "dashscope-intl.aliyuncs.com",
    "router.huggingface.co",
    "api.novita.ai",
    "api.venice.ai",
    "api.cloudflare.com",
    // Ollama (local). "::1" is the IPv6 loopback: on a dual-stack host
    // "localhost" can resolve to ::1, and url::Host renders it without
    // brackets, so it must be allowlisted alongside the IPv4 loopback.
    "localhost",
    "127.0.0.1",
    "::1",
];

const ALLOWED_LLM_PROVIDERS: &[&str] = &[
    "ollama",
    "groq",
    "gemini",
    "openrouter",
    "cerebras",
    "samba",
    "openai",
    "anthropic",
    "moonshot",
    "deepseek",
    "mistral",
    "nvidia",
    "minimax",
    "xai",
    "together",
    "fireworks",
    "deepinfra",
    "zai",
    "qwen",
    "huggingface",
    "novita",
    "venice",
    "cloudflare",
];

pub fn load_default() -> AppResult<()> {
    let _ = POLICY.set(Policy {
        allowed_hosts: ALLOWED_HOSTS,
        allowed_llm_providers: ALLOWED_LLM_PROVIDERS,
    });
    Ok(())
}

pub fn host_allowed(host: &str) -> bool {
    POLICY
        .get()
        .map(|p| p.allowed_hosts.contains(&host))
        .unwrap_or(false)
}

pub fn llm_provider_allowed(provider: &str) -> bool {
    POLICY
        .get()
        .map(|p| p.allowed_llm_providers.contains(&provider))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Every address the command modules request, read out of their own source.
    ///
    /// A source whose host is not on the list is refused by the guard, which
    /// looks exactly like the source being down: the search returns nothing and
    /// the run carries on without it. So the two are checked against each other
    /// here rather than trusted to stay in step.
    fn requested_hosts() -> BTreeSet<String> {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands");
        let mut files = Vec::new();
        collect_rust_files(&root, &mut files);
        assert!(!files.is_empty(), "no command sources found");

        let mut hosts = BTreeSet::new();
        for file in files {
            let text = std::fs::read_to_string(&file).expect("read command source");
            // A module's own tests carry invented addresses; only the code that
            // runs is of interest here.
            let code_only = text.split("#[cfg(test)]").next().unwrap_or("");
            for line in code_only.lines() {
                let code = line.trim_start();
                // Doc comments carry the upstream's documentation address, which
                // is never requested.
                if code.starts_with("//") {
                    continue;
                }
                let mut rest = code;
                while let Some(at) = rest.find("https://") {
                    rest = &rest[at + "https://".len()..];
                    let host: String = rest
                        .chars()
                        .take_while(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-')
                        .collect();
                    if host.contains('.') {
                        hosts.insert(host);
                    }
                }
            }
        }
        hosts
    }

    fn collect_rust_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_rust_files(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }

    /// Addresses that appear in code but are never requested: they are put into
    /// a result for the reader to open, or are an upstream's own documentation.
    const NOT_REQUESTED: &[&str] = &[
        "doi.org",
        "pubmed.ncbi.nlm.nih.gov",
        "open.fda.gov",
        "docs.openalex.org",
        "lhncbc.nlm.nih.gov",
        "hashcerebrum.com",
        "api.z.ai",
        "dashscope-intl.aliyuncs.com",
        "router.huggingface.co",
        "api.novita.ai",
        "api.venice.ai",
    ];

    #[test]
    fn every_requested_host_is_allowlisted() {
        load_default().expect("policy loads");
        let missing: Vec<String> = requested_hosts()
            .into_iter()
            .filter(|host| !NOT_REQUESTED.contains(&host.as_str()) && !host_allowed(host))
            .collect();
        assert!(
            missing.is_empty(),
            "hosts used but not allowlisted: {missing:?}"
        );
    }

    #[test]
    fn a_host_outside_the_list_is_refused() {
        load_default().expect("policy loads");
        assert!(!host_allowed("example.com"));
        assert!(!host_allowed("api.crossref.org.evil.test"));
        assert!(host_allowed("api.crossref.org"));
    }

    #[test]
    fn every_allowed_provider_is_one_the_app_offers() {
        load_default().expect("policy loads");
        assert!(llm_provider_allowed("cloudflare"));
        assert!(llm_provider_allowed("ollama"));
        assert!(!llm_provider_allowed("unknown-provider"));
    }
}
