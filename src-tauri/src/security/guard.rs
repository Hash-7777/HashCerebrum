//! Permission guard — every network/fs/keychain operation calls `check()`
//! before doing work. Denials are audited; approvals are audited.
//!
//! Categories:
//!   - Net(host)      — outbound HTTP to a host
//!   - Keychain(key)  — read/write/delete a keychain item
//!   - Fs(path)       — guarded file reads such as PDF extraction
//!   - Llm(provider)  — invoke an LLM provider

use crate::error::{AppError, AppResult};
use crate::security::{denylist, policy};
use std::net::IpAddr;
use std::path::Path;
use tauri::AppHandle;

#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
#[cfg(windows)]
use std::os::windows::fs::MetadataExt;

/// Ports allowed for localhost connections. Ollama default is 11434.
const LOCALHOST_PORTS: &[u16] = &[11434];

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum Action<'a> {
    Net { host: &'a str, port: Option<u16> },
    Keychain { key: &'a str },
    Fs { path: &'a str },
    Llm { provider: &'a str },
}

pub fn init(_app: &AppHandle) -> AppResult<()> {
    policy::load_default()?;
    Ok(())
}

/// Returns Ok(()) if allowed, AppError::PermissionDenied otherwise.
///
pub fn check(action: Action<'_>) -> AppResult<()> {
    match action {
        Action::Net { host, port } => {
            if denylist::is_blocked(host) {
                tracing::debug!(host, "host blocked by denylist");
                return Err(AppError::PermissionDenied("host blocked".into()));
            }
            if !policy::host_allowed(host) {
                tracing::debug!(host, "host not in allowlist");
                return Err(AppError::PermissionDenied("host not allowlisted".into()));
            }
            if is_localhost(host) {
                let p = port.unwrap_or(0);
                if !LOCALHOST_PORTS.contains(&p) {
                    tracing::debug!(port = p, "localhost port not allowed");
                    return Err(AppError::PermissionDenied(
                        "localhost port not allowed".into(),
                    ));
                }
            }
            Ok(())
        }
        Action::Keychain { key } => {
            if !policy::keychain_key_allowed(key) {
                tracing::debug!(key, "keychain key not allowlisted");
                return Err(AppError::PermissionDenied(
                    "keychain key not allowlisted".into(),
                ));
            }
            Ok(())
        }
        Action::Fs { path } => {
            let path = Path::new(path);

            // Reject paths with parent-directory traversal
            if path.components().any(|c| c.as_os_str() == "..") {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: path contains '..'".into(),
                ));
            }

            // Reject symlinks and capture metadata for TOCTOU check
            let meta = std::fs::symlink_metadata(path)
                .map_err(|_e| AppError::PermissionDenied("path validation failed".into()))?;
            if meta.file_type().is_symlink() {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: symlinks are not allowed".into(),
                ));
            }

            // Canonicalize to resolve any remaining relative components
            let canonical = path
                .canonicalize()
                .map_err(|_e| AppError::PermissionDenied("path validation failed".into()))?;

            // Reject sensitive system directories
            if is_sensitive_system_path(&canonical) {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: path is in a sensitive system directory".into(),
                ));
            }

            let is_pdf = path
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false);
            if !is_pdf {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: only PDF extraction is allowed".into(),
                ));
            }

            // TOCTOU defense: ensure the canonical file is the same inode+device
            // we inspected at symlink_metadata time. This catches races where the
            // file is replaced between our stat and canonicalize.
            let canonical_meta = std::fs::metadata(&canonical)
                .map_err(|_e| AppError::PermissionDenied("path validation failed".into()))?;
            if !same_file(&meta, &canonical_meta) {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: path changed during validation".into(),
                ));
            }

            // Hardlink defense: reject files with more than one link.
            // Both the original and each hardlink increment the count.
            if has_multiple_hardlinks(&meta) {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: hardlinks are not allowed".into(),
                ));
            }

            if !canonical_meta.is_file() {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: not a file".into(),
                ));
            }
            Ok(())
        }
        Action::Llm { provider } => {
            if !policy::llm_provider_allowed(provider) {
                tracing::debug!(provider, "LLM provider not allowlisted");
                return Err(AppError::PermissionDenied(
                    "LLM provider not allowlisted".into(),
                ));
            }
            Ok(())
        }
    }
}

/// Net check for an LLM provider request. Identical to the generic `Net` check,
/// except the `ollama` provider may also reach the user's own machine on their
/// LAN — RFC1918 / CGNAT / ULA addresses, `*.local` (mDNS), or a bare LAN
/// hostname — so Ollama can run on a second device on the same network (parity
/// with the desktop sibling app). Cloud-metadata, link-local, `0.0.0.0`, and
/// public hosts remain blocked even for ollama, so this is not a general SSRF
/// hole: the ollama path can only ever reach local/LAN targets.
pub fn check_llm_net(provider: &str, host: &str, port: Option<u16>) -> AppResult<()> {
    if provider == "ollama" {
        // Localhost must pass the port restriction BEFORE the LAN fast-return,
        // otherwise any localhost port is reachable via the Ollama path.
        if is_localhost(host) {
            let p = port.unwrap_or(0);
            if !LOCALHOST_PORTS.contains(&p) {
                return Err(AppError::PermissionDenied(
                    "localhost port not allowed".into(),
                ));
            }
            return Ok(());
        }
        if is_lan_ollama_host(host) {
            return Ok(());
        }
    }
    check(Action::Net { host, port })
}

/// May this host legitimately resolve to a private / loopback IP? True only for
/// the intentional local targets — `localhost`, a LAN IP, an mDNS `.local` name,
/// or a bare LAN hostname (the Ollama path). For every public host the DNS
/// resolver drops private addresses, so an allowlisted FQDN that is rebound to an
/// internal address cannot be connected to.
pub fn host_may_use_private_ip(host: &str) -> bool {
    is_localhost(host) || is_lan_ollama_host(host)
}

/// A host the Ollama provider is permitted to reach: loopback, a private/LAN IP,
/// an mDNS `.local` name, or a bare single-label hostname. Hard-blocked targets
/// (cloud metadata / link-local) are excluded, and a dotted public FQDN is not
/// matched, so the ollama path cannot reach arbitrary internet hosts.
fn is_lan_ollama_host(host: &str) -> bool {
    if denylist::is_hard_blocked(host) {
        return false;
    }
    if is_localhost(host) || denylist::is_private_lan(host) {
        return true;
    }
    let h = host.to_ascii_lowercase();
    if h.ends_with(".local") {
        return true;
    }
    // Bare single-label LAN/NetBIOS hostname (no dots, not an IP literal).
    !h.contains('.') && h.parse::<IpAddr>().is_err()
}

fn is_localhost(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    host.parse::<IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

#[cfg(unix)]
fn is_sensitive_system_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    let prefixes = [
        "/etc",
        "/proc",
        "/sys",
        "/dev",
        "/var",
        "/usr",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/boot",
        "/root",
        // macOS canonicalized paths (symlinks /etc → /private/etc, /var → /private/var)
        "/private/etc",
        "/private/var",
        "/private/tmp",
        "/System",
        "/Library",
        "/Users",
        "/Volumes",
    ];
    prefixes
        .iter()
        .any(|prefix| s.starts_with(&format!("{prefix}/")) || s == *prefix)
}

#[cfg(windows)]
fn is_sensitive_system_path(path: &Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    // Extract drive letter so we block sensitive dirs on ALL drives, not just C:\
    let drive = s
        .chars()
        .next()
        .and_then(|c| c.is_ascii_alphabetic().then_some(c));
    let drive_str = drive
        .map(|d| format!("{d}:"))
        .unwrap_or_else(|| "c:".to_string());
    let sensitive = [
        format!("{drive_str}\\windows"),
        format!("{drive_str}\\program files"),
        format!("{drive_str}\\program files (x86)"),
        format!("{drive_str}\\programdata"),
        format!("{drive_str}\\users\\all users"),
        format!("{drive_str}\\users\\default"),
        format!("{drive_str}\\windows\\system32"),
    ];
    sensitive.iter().any(|prefix| s.starts_with(prefix))
}

/// Compare two metadata structs to verify they refer to the same underlying
/// file (same device + inode). This defends against TOCTOU races where the
/// file is swapped between our initial stat and canonicalization.
#[cfg(unix)]
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(windows)]
fn same_file(a: &std::fs::Metadata, b: &std::fs::Metadata) -> bool {
    // Windows file_index is the NTFS MFT record number; volume_serial
    // identifies the volume. Together they uniquely identify a file.
    // On ReFS, exFAT, or network shares these values may be None. We must
    // NOT treat None == None as "same file" — that would make every two
    // files appear identical and bypass the TOCTOU guard entirely.
    match (
        a.file_index(),
        b.file_index(),
        a.volume_serial_number(),
        b.volume_serial_number(),
    ) {
        (Some(ai), Some(bi), Some(av), Some(bv)) => ai == bi && av == bv,
        _ => false, // cannot confirm same file — fail safe
    }
}

/// Reject files with multiple hardlinks. On Unix nlink > 1 means there are
/// additional directory entries pointing to the same inode.
#[cfg(unix)]
fn has_multiple_hardlinks(meta: &std::fs::Metadata) -> bool {
    meta.nlink() > 1
}

#[cfg(windows)]
fn has_multiple_hardlinks(_meta: &std::fs::Metadata) -> bool {
    // Windows hardlinks are rarer and harder to detect portably without
    // WinAPI calls. We rely on the same_file + canonical path checks.
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_detection() {
        assert!(is_localhost("localhost"));
        assert!(is_localhost("LOCALHOST"));
        assert!(is_localhost("127.0.0.1"));
        assert!(is_localhost("::1"));
        assert!(is_localhost("127.0.0.2"));
        assert!(is_localhost("127.255.255.255"));
        assert!(!is_localhost("192.168.1.1"));
        assert!(!is_localhost("10.0.0.1"));
        assert!(!is_localhost("example.com"));
        assert!(!is_localhost("169.254.169.254"));
    }

    #[test]
    fn ollama_may_reach_lan_but_others_and_dangerous_targets_cannot() {
        // The user's own machine / LAN — allowed for ollama.
        assert!(check_llm_net("ollama", "127.0.0.1", Some(11434)).is_ok());
        assert!(check_llm_net("ollama", "192.168.1.50", Some(11434)).is_ok());
        assert!(check_llm_net("ollama", "10.0.0.5", Some(11434)).is_ok());
        assert!(check_llm_net("ollama", "172.16.4.4", Some(11434)).is_ok());
        assert!(check_llm_net("ollama", "ollama.local", Some(11434)).is_ok());
        assert!(check_llm_net("ollama", "mybox", Some(11434)).is_ok());

        // Cloud metadata / link-local / public stay blocked even for ollama.
        assert!(check_llm_net("ollama", "169.254.169.254", Some(80)).is_err());
        assert!(check_llm_net("ollama", "8.8.8.8", Some(11434)).is_err());
        assert!(check_llm_net("ollama", "evil.example.com", Some(11434)).is_err());

        // Other providers get no LAN relaxation.
        assert!(check_llm_net("openai", "192.168.1.50", Some(11434)).is_err());
        assert!(check_llm_net("openai", "ollama.local", Some(11434)).is_err());
    }

    #[test]
    fn fs_guard_rejects_traversal() {
        let result = check(Action::Fs {
            path: "../etc/passwd",
        });
        assert!(result.is_err());
    }

    #[test]
    fn fs_guard_rejects_non_pdf() {
        let result = check(Action::Fs {
            path: "/tmp/data.txt",
        });
        assert!(result.is_err());
    }

    #[test]
    #[cfg(unix)]
    fn fs_guard_blocks_macos_private_paths() {
        // /private/etc and /private/var are macOS canonicalized symlinks.
        // We must block them even though the raw path doesn't start with /etc.
        let blocked = [
            "/private/etc/passwd",
            "/private/var/db/shadow",
            "/System/Library/Extensions",
            "/Library/Application Support",
        ];
        for path in &blocked {
            let result = check(Action::Fs { path });
            assert!(result.is_err(), "expected {path} to be blocked but got Ok");
        }
    }

    #[test]
    #[cfg(unix)]
    fn fs_guard_allows_etcetera_false_positive() {
        // The old /etc prefix blocked /etcetera/file.pdf (false positive).
        // With the fixed prefix check (/etc/ or exactly /etc), this should pass
        // the sensitive-path check but still fail because it's not a real file.
        let result = check(Action::Fs {
            path: "/etcetera/data.pdf",
        });
        // Sensitive-path should NOT be the reason for rejection here.
        // It will be rejected because the file does not exist.
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            !msg.contains("sensitive system directory"),
            "false positive: /etcetera was treated as /etc: {msg}"
        );
    }
}
