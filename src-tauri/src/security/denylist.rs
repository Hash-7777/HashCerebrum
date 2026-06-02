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

use std::net::IpAddr;

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

/// Always-blocked targets — cloud metadata, link-local, 0.0.0.0.
pub fn is_hard_blocked(host: &str) -> bool {
    if HARD_BLOCKED_HOSTS.contains(&host) {
        return true;
    }
    HARD_BLOCKED_PREFIXES.iter().any(|p| host.starts_with(p))
}

/// True only for an actual private / LAN **IP address**: RFC1918, CGNAT
/// (RFC6598), or IPv6 ULA (`fc00::/7`).
///
/// The host is parsed as an `IpAddr` first — a previous string-prefix list
/// matched any hostname starting with "fd" (e.g. `fda.gov`, `fdic.gov`) as
/// private, which the Ollama LAN exception then allowed, opening an SSRF hole.
/// A non-IP hostname is NOT private here; legitimate LAN *names* (`*.local`,
/// bare single-label hosts) are handled for the Ollama path in
/// `guard::is_lan_ollama_host`, so running Ollama on another LAN device still
/// works while public FQDNs can never match.
pub fn is_private_lan(host: &str) -> bool {
    // Tolerate a bracketed IPv6 literal like `[fd00::1]`.
    let h = host.trim_start_matches('[').trim_end_matches(']');
    match h.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            let o = v4.octets();
            // RFC1918 (10/8, 172.16/12, 192.168/16) + CGNAT 100.64.0.0/10.
            v4.is_private() || (o[0] == 100 && (64..=127).contains(&o[1]))
        }
        // IPv6 unique-local fc00::/7 (covers fc00:: and fd00::). Link-local
        // fe80::/10 is hard-blocked separately, not treated as private-LAN.
        Ok(IpAddr::V6(v6)) => (v6.segments()[0] & 0xfe00) == 0xfc00,
        Err(_) => false,
    }
}

pub fn is_blocked(host: &str) -> bool {
    // localhost is allowed for Ollama — handled in policy/guard, not here.
    is_hard_blocked(host) || is_private_lan(host)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_fqdns_starting_with_fd_are_not_private() {
        // The SSRF regression: these are public hosts, never private-LAN.
        for h in ["fda.gov", "fdic.gov", "fd-example.com", "feed.example.org"] {
            assert!(!is_private_lan(h), "{h} must not be treated as private LAN");
            assert!(!is_blocked(h), "{h} must not be denylist-blocked");
        }
    }

    #[test]
    fn real_lan_addresses_are_private() {
        for h in [
            "192.168.1.50", "10.0.0.5", "172.16.4.9", "172.31.255.1",
            "100.64.0.1", "fd00::1", "fc00::abcd", "[fd12:3456::1]",
        ] {
            assert!(is_private_lan(h), "{h} should be private LAN (LAN Ollama target)");
        }
    }

    #[test]
    fn public_ips_and_link_local_are_not_private() {
        assert!(!is_private_lan("8.8.8.8"));
        assert!(!is_private_lan("2607:f8b0::1")); // public IPv6
        assert!(!is_private_lan("fe80::1")); // link-local (hard-blocked elsewhere)
        // Link-local + metadata stay hard-blocked.
        assert!(is_hard_blocked("169.254.169.254"));
        assert!(is_hard_blocked("fe80::1"));
    }
}
