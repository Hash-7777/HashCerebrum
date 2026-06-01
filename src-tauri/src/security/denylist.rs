//! Hosts that are NEVER allowed regardless of allowlist.
//!
//! Blocks SSRF vectors (private IP ranges, link-local, metadata endpoints)
//! and known-bad hosts. Checked before the allowlist.
//!
//! Two tiers:
//!   - HARD blocks (`is_hard_blocked`): cloud-metadata, link-local, 0.0.0.0.
//!     Never reachable by anything, including the local-Ollama LAN path.
//!   - PRIVATE-LAN ranges (`is_private_lan`): RFC1918 / CGNAT / ULA. Blocked for
//!     the general allowlist path, but the `ollama` provider may reach them
//!     (see guard::check_llm_net) so a user can run Ollama on another device on
//!     their own network.
//!
//! `is_blocked` = hard OR private-lan, preserving the strict default for every
//! non-Ollama caller (medical sources, all cloud LLMs).

/// Cloud-metadata + known-bad exact hosts. Always blocked.
const HARD_BLOCKED_HOSTS: &[&str] = &[
    "169.254.169.254", // AWS / GCP metadata
    "metadata.google.internal",
    "metadata.azure.com",
    "0.0.0.0",
];

/// Link-local prefixes (incl. all cloud metadata at 169.254/16). Always blocked,
/// even for the Ollama LAN path — link-local is not a legitimate Ollama target.
const HARD_BLOCKED_PREFIXES: &[&str] = &["169.254.", "fe80:"];

/// Private / LAN ranges: RFC1918, CGNAT (RFC6598), and IPv6 ULA. Blocked for the
/// general path; allowed only for the user's LAN Ollama.
const PRIVATE_LAN_PREFIXES: &[&str] = &[
    "10.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
    "192.168.", "fc00:", "fd",
    // CGNAT / Shared Address Space (RFC 6598) — effectively private IP space
    "100.64.", "100.65.", "100.66.", "100.67.", "100.68.", "100.69.", "100.70.", "100.71.",
    "100.72.", "100.73.", "100.74.", "100.75.", "100.76.", "100.77.", "100.78.", "100.79.",
    "100.80.", "100.81.", "100.82.", "100.83.", "100.84.", "100.85.", "100.86.", "100.87.",
    "100.88.", "100.89.", "100.90.", "100.91.", "100.92.", "100.93.", "100.94.", "100.95.",
    "100.96.", "100.97.", "100.98.", "100.99.", "100.100.", "100.101.", "100.102.", "100.103.",
    "100.104.", "100.105.", "100.106.", "100.107.", "100.108.", "100.109.", "100.110.", "100.111.",
    "100.112.", "100.113.", "100.114.", "100.115.", "100.116.", "100.117.", "100.118.", "100.119.",
    "100.120.", "100.121.", "100.122.", "100.123.", "100.124.", "100.125.", "100.126.", "100.127.",
];

/// Always-blocked targets — cloud metadata, link-local, 0.0.0.0.
pub fn is_hard_blocked(host: &str) -> bool {
    if HARD_BLOCKED_HOSTS.contains(&host) {
        return true;
    }
    HARD_BLOCKED_PREFIXES.iter().any(|p| host.starts_with(p))
}

/// Private / LAN address (RFC1918 / CGNAT / ULA).
pub fn is_private_lan(host: &str) -> bool {
    PRIVATE_LAN_PREFIXES.iter().any(|p| host.starts_with(p))
}

pub fn is_blocked(host: &str) -> bool {
    // localhost is allowed for Ollama — handled in policy/guard, not here.
    is_hard_blocked(host) || is_private_lan(host)
}
