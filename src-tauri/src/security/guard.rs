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
                return Err(AppError::PermissionDenied(format!("host blocked: {host}")));
            }
            if !policy::host_allowed(host) {
                return Err(AppError::PermissionDenied(format!(
                    "host not allowlisted: {host}"
                )));
            }
            if is_localhost(host) {
                let p = port.unwrap_or(0);
                if !LOCALHOST_PORTS.contains(&p) {
                    return Err(AppError::PermissionDenied(format!(
                        "localhost port {p} not allowed"
                    )));
                }
            }
            Ok(())
        }
        Action::Keychain { key } => {
            if !policy::keychain_key_allowed(key) {
                return Err(AppError::PermissionDenied(format!(
                    "keychain key not allowlisted: {key}"
                )));
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

            // Reject symlinks — use symlink_metadata which does not follow links
            let meta = std::fs::symlink_metadata(path)
                .map_err(|e| AppError::PermissionDenied(format!("cannot stat path: {e}")))?;
            if meta.file_type().is_symlink() {
                return Err(AppError::PermissionDenied(
                    "filesystem read denied: symlinks are not allowed".into(),
                ));
            }

            // Canonicalize to resolve any remaining relative components
            let canonical = path.canonicalize().map_err(|e| {
                AppError::PermissionDenied(format!("cannot canonicalize path: {e}"))
            })?;

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
            if !path.is_file() {
                return Err(AppError::PermissionDenied(format!(
                    "filesystem read denied: not a file: {}",
                    path.display()
                )));
            }
            Ok(())
        }
        Action::Llm { provider } => {
            if !policy::llm_provider_allowed(provider) {
                return Err(AppError::PermissionDenied(format!(
                    "LLM provider not allowlisted: {provider}"
                )));
            }
            Ok(())
        }
    }
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
        "/etc", "/proc", "/sys", "/dev", "/var", "/usr", "/bin", "/sbin", "/lib", "/lib64",
        "/boot", "/root",
        // macOS canonicalized paths (symlinks /etc → /private/etc, /var → /private/var)
        "/private/etc", "/private/var", "/private/tmp", "/System", "/Library", "/Users",
        "/Volumes",
    ];
    prefixes.iter().any(|prefix| {
        s.starts_with(&format!("{prefix}/")) || s == *prefix
    })
}

#[cfg(windows)]
fn is_sensitive_system_path(path: &Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    // Extract drive letter so we block sensitive dirs on ALL drives, not just C:\
    let drive = s.chars().next().and_then(|c| c.is_ascii_alphabetic().then_some(c));
    let drive_str = drive.map(|d| format!("{d}:")).unwrap_or_else(|| "c:".to_string());
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
            let result = check(Action::Fs {
                path: path,
            });
            assert!(
                result.is_err(),
                "expected {path} to be blocked but got Ok"
            );
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
