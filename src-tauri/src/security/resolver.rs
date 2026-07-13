//! DNS resolver that closes the DNS-rebinding window.
//!
//! The guard validates the destination HOSTNAME against the allowlist, but the
//! hostname is only resolved to an IP at connection time — a hostname that passes
//! the guard could resolve (or be re-resolved by a hostile/poisoned DNS answer) to
//! `127.0.0.1` or a LAN address, letting a request reach an internal service
//! (SSRF via DNS rebinding). This resolver performs the resolution itself, drops
//! any private / loopback / link-local address for a PUBLIC host, and hands reqwest
//! the exact vetted addresses — so there is a single resolution and the connection
//! can only go to an address we approved.
//!
//! The intentional local target (Ollama on localhost or the LAN) is preserved:
//! `guard::host_may_use_private_ip` returns true for those hosts, and only for
//! those is a private address allowed through.

use crate::security::{denylist, guard};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use std::net::SocketAddr;

/// A reqwest DNS resolver that filters out internal addresses for public hosts.
#[derive(Debug, Clone, Default)]
pub struct GuardedResolver;

impl Resolve for GuardedResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let allow_private = guard::host_may_use_private_ip(&host);
            // Resolve via the system resolver (port 0 is only used to form the
            // lookup; reqwest overrides the real port on connect).
            let resolved = tokio::net::lookup_host((host.as_str(), 0)).await?;
            let filtered: Vec<SocketAddr> = resolved
                .filter(|addr| allow_private || !denylist::is_internal_ip(&addr.ip()))
                .collect();
            if filtered.is_empty() {
                // Either the name did not resolve, or every address it resolved to
                // was internal for a public host — refuse rather than connect.
                let err: Box<dyn std::error::Error + Send + Sync> =
                    format!("host '{host}' resolved to no permitted address").into();
                return Err(err);
            }
            let addrs: Addrs = Box::new(filtered.into_iter());
            Ok(addrs)
        })
    }
}

#[cfg(test)]
mod tests {
    use crate::security::denylist::is_internal_ip;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn loopback_and_private_ipv4_are_internal() {
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))));
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))));
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(172, 16, 3, 9))));
        // CGNAT and the cloud-metadata link-local endpoint.
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(100, 64, 0, 1))));
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(
            169, 254, 169, 254
        ))));
        assert!(is_internal_ip(&IpAddr::V4(Ipv4Addr::new(0, 0, 0, 0))));
    }

    #[test]
    fn public_ipv4_is_not_internal() {
        assert!(!is_internal_ip(&IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_internal_ip(&IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))));
    }

    #[test]
    fn loopback_and_ula_and_linklocal_ipv6_are_internal() {
        assert!(is_internal_ip(&IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_internal_ip(&IpAddr::V6("fd00::1".parse().unwrap()))); // ULA
        assert!(is_internal_ip(&IpAddr::V6("fe80::1".parse().unwrap()))); // link-local
    }

    #[test]
    fn public_ipv6_is_not_internal() {
        assert!(!is_internal_ip(&IpAddr::V6(
            "2606:4700:4700::1111".parse().unwrap()
        )));
    }
}
