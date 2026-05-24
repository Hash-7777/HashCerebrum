use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
#[allow(unused_imports)]
use serde::Serialize;
use std::path::{Path, PathBuf};
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

fn try_open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;

         CREATE TABLE IF NOT EXISTS cache (
            key         TEXT PRIMARY KEY,
            host        TEXT NOT NULL,
            payload     BLOB NOT NULL,
            fetched_at  TEXT NOT NULL,
            ttl_seconds INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_cache_host ON cache(host);
         CREATE INDEX IF NOT EXISTS idx_cache_fetched ON cache(fetched_at);",
    )?;

    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap_or_else(|_| "unknown".into());
    if integrity != "ok" {
        tracing::error!(result = %integrity, "cache database integrity check failed");
        return Err(AppError::Cache(format!("integrity check: {integrity}")));
    }

    Ok(conn)
}

pub fn init(app: &AppHandle) -> AppResult<()> {
    let path = cache_path(app)?;

    let conn = match try_open(&path) {
        Ok(c) => c,
        Err(e) => {
            // Corrupt or unreadable — delete the file and start fresh.
            tracing::warn!(error = %e, "cache init failed, deleting and retrying");
            let _ = std::fs::remove_file(&path);
            try_open(&path)?
        }
    };

    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex poisoned: {e}")))?;
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
    let guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_ref()
        .ok_or_else(|| AppError::Cache("cache not initialized".into()))?;
    f(conn)
}

/// Like `with_conn` but returns `Ok(None)` when the cache is unavailable.
/// Used for `get` and `set` so a cache miss never fails a network call.
fn with_conn_opt<T>(f: impl FnOnce(&Connection) -> AppResult<Option<T>>) -> AppResult<Option<T>> {
    let guard = match DB.lock() {
        Ok(g) => g,
        Err(_) => return Ok(None),
    };
    let Some(conn) = guard.as_ref() else {
        return Ok(None);
    };
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

/// Read a cached entry if it exists and has not expired.
/// ttl_seconds = 0 means "live forever".
/// Returns Ok(None) when the cache is unavailable — callers treat this as a miss.
pub fn get(key: &str) -> AppResult<Option<Vec<u8>>> {
    with_conn_opt(|conn| {
        let row: Option<(Vec<u8>, i64, i64)> = conn
            .query_row(
                "SELECT payload, ttl_seconds, strftime('%s', fetched_at)
                 FROM cache WHERE key = ?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((payload, ttl, fetched_at)) = row else {
            return Ok(None);
        };
        if ttl > 0 {
            let now = chrono::Utc::now().timestamp();
            if now - fetched_at > ttl {
                return Ok(None);
            }
        }
        Ok(Some(payload))
    })
}

/// Write or overwrite a cached entry.
/// Silently no-ops when the cache is unavailable — the caller's request still completes.
pub fn set(key: &str, host: &str, payload: &[u8], ttl_seconds: i64) -> AppResult<()> {
    let guard = match DB.lock() {
        Ok(g) => g,
        Err(_) => return Ok(()),
    };
    let Some(conn) = guard.as_ref() else {
        return Ok(());
    };
    conn.execute(
        "INSERT INTO cache (key, host, payload, fetched_at, ttl_seconds)
         VALUES (?1, ?2, ?3, datetime('now'), ?4)
         ON CONFLICT(key) DO UPDATE SET
           host = excluded.host,
           payload = excluded.payload,
           fetched_at = excluded.fetched_at,
           ttl_seconds = excluded.ttl_seconds",
        params![key, host, payload, ttl_seconds],
    )?;
    Ok(())
}

pub fn close_connection() -> AppResult<()> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex poisoned: {e}")))?;
    if let Some(conn) = guard.take() {
        conn.close()
            .map_err(|(_, e)| AppError::Cache(e.to_string()))?;
    }
    Ok(())
}
