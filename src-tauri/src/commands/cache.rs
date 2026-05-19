//! Cache inspection + clear commands. Exposed so Settings can show
//! per-host row/byte counts and let the user purge the cache.

use crate::cache;
use crate::error::AppResult;

#[tauri::command]
pub async fn cache_stats() -> AppResult<cache::CacheStats> {
    cache::stats()
}

#[tauri::command]
pub async fn cache_clear() -> AppResult<u64> {
    cache::purge_all()
}

#[tauri::command]
pub async fn cache_clear_expired() -> AppResult<u64> {
    cache::purge_expired()
}
