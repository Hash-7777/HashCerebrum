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

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum Action<'a> {
    Net { host: &'a str },
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
        Action::Net { host } => {
            if denylist::is_blocked(host) {
                return Err(AppError::PermissionDenied(format!("host blocked: {host}")));
            }
            if !policy::host_allowed(host) {
                return Err(AppError::PermissionDenied(format!("host not allowlisted: {host}")));
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
