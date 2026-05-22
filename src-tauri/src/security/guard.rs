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
                return Err(AppError::PermissionDenied(format!("host not allowlisted: {host}")));
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
            let meta = std::fs::symlink_metadata(path).map_err(|e| {
                AppError::PermissionDenied(format!("cannot stat path: {e}"))
            })?;
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
    host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1" || host == "::1"
}

#[cfg(unix)]
fn is_sensitive_system_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    [
        "/etc", "/proc", "/sys", "/dev", "/var", "/usr", "/bin", "/sbin", "/lib",
        "/lib64", "/boot", "/root",
    ]
    .iter()
    .any(|prefix| s.starts_with(prefix))
}

#[cfg(windows)]
fn is_sensitive_system_path(path: &Path) -> bool {
    let s = path.to_string_lossy().to_lowercase();
    [
        r"C:\Windows",
        r"C:\Program Files",
        r"C:\Program Files (x86)",
        r"C:\ProgramData",
        r"C:\Users\All Users",
        r"C:\Users\Default",
        r"C:\Windows\System32",
    ]
    .iter()
    .any(|prefix| s.starts_with(&prefix.to_lowercase()))
}
