use crate::error::{AppError, AppResult};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{params, OptionalExtension};
#[allow(unused_imports)]
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

type Pool = r2d2::Pool<SqliteConnectionManager>;
static POOL: std::sync::OnceLock<Pool> = std::sync::OnceLock::new();

/// Upper bound on cached rows. On each write, entries beyond the most recent
/// MAX_CACHE_ROWS are evicted oldest-first so the cache file cannot grow without
/// limit. Combined with purge_expired this keeps the cache bounded over time.
const MAX_CACHE_ROWS: i64 = 2_000;
const MAX_CACHE_PAYLOAD_BYTES: usize = 1024 * 1024; // 1 MB

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

    let manager = SqliteConnectionManager::file(&path);
    let pool = r2d2::Pool::builder()
        .max_size(4)
        .connection_customizer(Box::new(CacheCustomizer))
        .build(manager)
        .map_err(|e| AppError::Cache(format!("pool build: {e}")))?;

    // Validate first connection
    let conn = pool
        .get()
        .map_err(|e| AppError::Cache(format!("pool get: {e}")))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap_or_else(|_| "unknown".into());
    if integrity != "ok" {
        tracing::error!(result = %integrity, "cache database integrity check failed");
        return Err(AppError::Cache(format!("integrity check: {integrity}")));
    }

    let _ = POOL.set(pool);
    Ok(())
}

#[derive(Debug)]
struct CacheCustomizer;

impl r2d2::CustomizeConnection<rusqlite::Connection, rusqlite::Error> for CacheCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA temp_store = MEMORY;
             PRAGMA busy_timeout = 5000;

             CREATE TABLE IF NOT EXISTS cache (
                key         TEXT PRIMARY KEY,
                host        TEXT NOT NULL,
                payload     BLOB NOT NULL,
                fetched_at  TEXT NOT NULL,
                ttl_seconds INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_cache_host ON cache(host);
             CREATE INDEX IF NOT EXISTS idx_cache_fetched ON cache(fetched_at);",
        )
    }
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

fn with_conn<T>(f: impl FnOnce(&rusqlite::Connection) -> AppResult<T>) -> AppResult<T> {
    let pool = POOL
        .get()
        .ok_or_else(|| AppError::Cache("cache not initialized".into()))?;
    let conn = pool
        .get()
        .map_err(|e| AppError::Cache(format!("pool: {e}")))?;
    f(&conn)
}

/// Like `with_conn` but returns `Ok(None)` when the cache is unavailable.
/// Used for `get` and `set` so a cache miss never fails a network call.
fn with_conn_opt<T>(
    f: impl FnOnce(&rusqlite::Connection) -> AppResult<Option<T>>,
) -> AppResult<Option<T>> {
    let pool = match POOL.get() {
        Some(p) => p,
        None => return Ok(None),
    };
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };
    f(&conn)
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
    if payload.len() > MAX_CACHE_PAYLOAD_BYTES {
        return Err(AppError::Cache(format!(
            "payload {} bytes exceeds max {} bytes",
            payload.len(),
            MAX_CACHE_PAYLOAD_BYTES
        )));
    }
    let pool = match POOL.get() {
        Some(p) => p,
        None => return Ok(()),
    };
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return Ok(()),
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
    // Evict oldest rows beyond the cap (best-effort — a failed eviction must
    // not fail the write). "LIMIT -1 OFFSET n" selects every row past the
    // newest n for deletion.
    if let Err(e) = conn.execute(
        "DELETE FROM cache WHERE key IN (
           SELECT key FROM cache ORDER BY fetched_at DESC LIMIT -1 OFFSET ?1
         )",
        params![MAX_CACHE_ROWS],
    ) {
        tracing::warn!(error = %e, "cache eviction failed");
    }
    Ok(())
}

pub fn close_connection() -> AppResult<()> {
    // r2d2 pools close automatically when dropped.
    // We cannot remove from OnceLock, but we can clear remaining connections.
    Ok(())
}
