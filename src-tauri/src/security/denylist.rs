//! Hosts that are NEVER allowed regardless of allowlist.
//!
//! Blocks SSRF vectors (private IP ranges, link-local, metadata endpoints)
//! and known-bad hosts. Checked before the allowlist.

const BLOCKED_HOSTS: &[&str] = &[
    "169.254.169.254", // AWS / GCP metadata
    "metadata.google.internal",
    "metadata.azure.com",
    "0.0.0.0",
];

const BLOCKED_PREFIXES: &[&str] = &[
    "10.",
    "172.16.",
    "172.17.",
    "172.18.",
    "172.19.",
    "172.20.",
    "172.21.",
    "172.22.",
    "172.23.",
    "172.24.",
    "172.25.",
    "172.26.",
    "172.27.",
    "172.28.",
    "172.29.",
    "172.30.",
    "172.31.",
    "192.168.",
    "fc00:",
    "fd",
    "fe80:",
];

pub fn is_blocked(host: &str) -> bool {
    if BLOCKED_HOSTS.iter().any(|h| *h == host) {
        return true;
    }
    // localhost is allowed for Ollama — handled in policy, not here.
    BLOCKED_PREFIXES.iter().any(|p| host.starts_with(p))
}
