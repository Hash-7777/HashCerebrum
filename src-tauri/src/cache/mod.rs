//! Source response cache (SQLite). Keyed by SHA-256 of (host, query),
//! with per-source TTL. Saves rate-limit budget and works offline for
//! recently-fetched queries.

pub mod sqlite;

pub use sqlite::{close_connection, stats, purge_all, purge_expired, CacheStats};

use crate::error::AppResult;
use tauri::AppHandle;

pub fn init(app: &AppHandle) -> AppResult<()> {
    sqlite::init(app)
}
