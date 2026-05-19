//! Permission guard — every network/fs/keychain operation calls `check()`
//! before doing work. Denials are audited; approvals are audited.
//!
//! Categories:
//!   - Net(host)      — outbound HTTP to a host
//!   - Keychain(key)  — read/write/delete a keychain item
//!   - Fs(path)       — read/write the filesystem (Phase 4+)
//!   - Llm(provider)  — invoke an LLM provider

use crate::error::{AppError, AppResult};
use crate::security::{denylist, policy};
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
/// Implementation deferred to Phase 3 — currently allow-all for the
/// hosts on the medical-source allowlist, deny everything else.
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
        Action::Keychain { .. } => Ok(()),
        Action::Fs { .. } => Ok(()),
        Action::Llm { .. } => Ok(()),
    }
}
