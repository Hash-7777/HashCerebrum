//! Hash-chained, append-only audit log.
//!
//! Every privileged action — network call, keychain access, agent tool
//! invocation — appends one entry. Each entry contains the SHA-256 of
//! the previous entry, so any tampering invalidates the chain from that
//! point onward. `audit_log_verify` walks the chain and reports breaks.
//!
//! This is what makes "HashCerebrum" a load-bearing name, not just brand.

pub mod chain;
pub mod store;

use crate::error::AppResult;
use tauri::AppHandle;

pub fn init(app: &AppHandle) -> AppResult<()> {
    store::init(app)?;
    Ok(())
}
