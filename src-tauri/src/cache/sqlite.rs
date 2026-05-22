use crate::error::{AppError, AppResult};
#[allow(unused_imports)]
use serde::Serialize;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static DB: Mutex<Option<Connection>> = Mutex::new(None);

fn cache_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Cache(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Cache(e.to_string()))?;
    Ok(dir.join("cache.sqlite"))
}

pub fn init(app: &AppHandle) -> AppResult<()> {
    let path = cache_path(app)?;
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cache (
            key         TEXT PRIMARY KEY,
            host        TEXT NOT NULL,
            payload     BLOB NOT NULL,
            fetched_at  TEXT NOT NULL,
            ttl_seconds INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_cache_host ON cache(host);
         CREATE INDEX IF NOT EXISTS idx_cache_fetched ON cache(fetched_at);",
    )?;
    let mut guard = DB.lock().map_err(|e| AppError::Cache(format!("mutex poisoned: {e}")))?;
    *guard = Some(conn);
    Ok(())
}

#[derive(serde::Serialize)]
pub struct CacheStats {
    pub rows: u64,
    pub bytes: u64,
    pub hosts: Vec<HostStat>,
}

#[derive(serde::Serialize)]
pub struct HostStat {
    pub host: String,
    pub rows: u64,
    pub bytes: u64,
}

fn with_conn<T>(f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
    let guard = DB.lock().map_err(|e| AppError::Cache(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| AppError::Cache("cache not initialized".into()))?;
    f(conn)
}

pub fn stats() -> AppResult<CacheStats> {
    with_conn(|conn| {
        let (rows_i64, bytes_i64): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(length(payload)), 0) FROM cache",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((0, 0));
        if rows_i64 < 0 || bytes_i64 < 0 {
            return Err(AppError::Cache("negative count from SQLite".into()));
        }
        let rows = rows_i64 as u64;
        let bytes = bytes_i64 as u64;

        let mut hosts = Vec::new();
        let mut stmt = conn.prepare(
            "SELECT host, COUNT(*), COALESCE(SUM(length(payload)), 0) FROM cache GROUP BY host ORDER BY 3 DESC",
        )?;
        let rows_iter = stmt.query_map([], |row| {
            Ok(HostStat {
                host: row.get::<_, String>(0)?,
                rows: row.get::<_, i64>(1)? as u64,
                bytes: row.get::<_, i64>(2)? as u64,
            })
        })?;
        for r in rows_iter {
            hosts.push(r?);
        }
        Ok(CacheStats { rows, bytes, hosts })
    })
}

pub fn purge_all() -> AppResult<u64> {
    with_conn(|conn| {
        let removed = conn.execute("DELETE FROM cache", [])? as u64;
        Ok(removed)
    })
}

pub fn purge_expired() -> AppResult<u64> {
    with_conn(|conn| {
        // ttl_seconds=0 means "live forever"; everything else expires
        // strftime('%s') seconds past fetched_at.
        let removed = conn.execute(
            "DELETE FROM cache
             WHERE ttl_seconds > 0
               AND (strftime('%s','now') - strftime('%s', fetched_at)) > ttl_seconds",
            [],
        )? as u64;
        Ok(removed)
    })
}

pub fn close_connection() -> AppResult<()> {
    let mut guard = DB.lock().map_err(|e| AppError::Cache(format!("mutex poisoned: {e}")))?;
    if let Some(conn) = guard.take() {
        conn.close().map_err(|(_, e)| AppError::Cache(e.to_string()))?;
    }
    Ok(())
}
