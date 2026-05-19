//! Declarative policy — allowed hosts, allowed keychain keys, etc.
//!
//! Loaded once at startup; checked on every `guard::check()` call.
//! Lives in code (not config) so it cannot be tampered with at runtime
//! by a compromised renderer.

use crate::error::AppResult;
use std::sync::OnceLock;

#[derive(Debug)]
pub struct Policy {
    pub allowed_hosts: &'static [&'static str],
    pub allowed_keychain_keys: &'static [&'static str],
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
    // Ollama (local)
    "localhost",
    "127.0.0.1",
];

const ALLOWED_KEYCHAIN_KEYS: &[&str] = &[
    "llm.groq",
    "llm.gemini",
    "llm.openrouter",
    "llm.cerebras",
    "llm.samba",
    "llm.openai",
    "llm.anthropic",
    "llm.moonshot",
    "llm.deepseek",
    "llm.mistral",
    "llm.nvidia",
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
];

pub fn load_default() -> AppResult<()> {
    let _ = POLICY.set(Policy {
        allowed_hosts: ALLOWED_HOSTS,
        allowed_keychain_keys: ALLOWED_KEYCHAIN_KEYS,
        allowed_llm_providers: ALLOWED_LLM_PROVIDERS,
    });
    Ok(())
}

pub fn host_allowed(host: &str) -> bool {
    POLICY
        .get()
        .map(|p| p.allowed_hosts.iter().any(|h| *h == host))
        .unwrap_or(false)
}

pub fn keychain_key_allowed(key: &str) -> bool {
    POLICY
        .get()
        .map(|p| p.allowed_keychain_keys.iter().any(|allowed| *allowed == key))
        .unwrap_or(false)
}

pub fn llm_provider_allowed(provider: &str) -> bool {
    POLICY
        .get()
        .map(|p| p.allowed_llm_providers.iter().any(|allowed| *allowed == provider))
        .unwrap_or(false)
}
