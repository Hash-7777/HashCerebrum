//! Cache inspection + clear commands. Exposed so Settings can show
//! per-host row/byte counts and let the user purge the cache.

use crate::audit::store as audit;
use crate::cache;
use crate::error::AppResult;

#[tauri::command]
pub async fn cache_stats() -> AppResult<cache::CacheStats> {
    cache::stats()
}

#[tauri::command]
pub async fn cache_clear() -> AppResult<u64> {
    let removed = cache::purge_all()?;
    if let Err(e) = audit::append(
        "cache",
        "user",
        "clear_all",
        &serde_json::json!({ "removed": removed }),
    ) {
        tracing::error!("audit append failed for cache_clear: {e}");
    }
    Ok(removed)
}

#[tauri::command]
pub async fn cache_clear_expired() -> AppResult<u64> {
    let removed = cache::purge_expired()?;
    if let Err(e) = audit::append(
        "cache",
        "user",
        "clear_expired",
        &serde_json::json!({ "removed": removed }),
    ) {
        tracing::error!("audit append failed for cache_clear_expired: {e}");
    }
    Ok(removed)
}
