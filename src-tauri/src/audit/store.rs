//! SQLite-backed audit log. Append-only by convention — no DELETE/UPDATE
//! statements anywhere in the codebase. Any code that *adds* one fails review.

use crate::audit::chain::{AuditEntry, GENESIS_HASH};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static DB: Mutex<Option<Connection>> = Mutex::new(None);

fn audit_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Audit(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Audit(e.to_string()))?;
    Ok(dir.join("audit.sqlite"))
}

pub fn init(app: &AppHandle) -> AppResult<()> {
    let path = audit_path(app)?;
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS audit (
            seq         INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT NOT NULL,
            category    TEXT NOT NULL,
            subject     TEXT NOT NULL,
            action      TEXT NOT NULL,
            data_hash   TEXT NOT NULL,
            prev_hash   TEXT NOT NULL,
            entry_hash  TEXT NOT NULL UNIQUE
         );
         CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
         CREATE INDEX IF NOT EXISTS idx_audit_cat ON audit(category);",
    )?;
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    *guard = Some(conn);
    Ok(())
}

pub(crate) fn append(
    category: &str,
    subject: &str,
    action: &str,
    payload: &serde_json::Value,
) -> AppResult<AuditEntry> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;

    let (prev_seq, prev_hash): (u64, String) = conn
        .query_row(
            "SELECT seq, entry_hash FROM audit ORDER BY seq DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, GENESIS_HASH.to_string()));

    let entry = AuditEntry::new(prev_seq + 1, category, subject, action, payload, prev_hash);
    conn.execute(
        "INSERT INTO audit (ts, category, subject, action, data_hash, prev_hash, entry_hash)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            entry.ts.to_rfc3339(),
            entry.category,
            entry.subject,
            entry.action,
            entry.data_hash,
            entry.prev_hash,
            entry.entry_hash,
        ],
    )?;
    Ok(entry)
}

pub fn read_all() -> AppResult<Vec<AuditEntry>> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;
    let mut stmt = conn.prepare(
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash
         FROM audit ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map([], |r| {
            let ts: String = r.get(1)?;
            Ok(AuditEntry {
                seq: r.get(0)?,
                ts: chrono::DateTime::parse_from_rfc3339(&ts)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                    .with_timezone(&chrono::Utc),
                category: r.get(2)?,
                subject: r.get(3)?,
                action: r.get(4)?,
                data_hash: r.get(5)?,
                prev_hash: r.get(6)?,
                entry_hash: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn count() -> AppResult<u64> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;
    let rows = conn.query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0))?;
    Ok(rows)
}

pub fn read_page(offset: u64, limit: u64) -> AppResult<Vec<AuditEntry>> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;
    let limit = limit.clamp(1, 500);
    let mut stmt = conn.prepare(
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash
         FROM audit ORDER BY seq ASC LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt
        .query_map(params![limit, offset], |r| {
            let ts: String = r.get(1)?;
            Ok(AuditEntry {
                seq: r.get(0)?,
                ts: chrono::DateTime::parse_from_rfc3339(&ts)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?
                    .with_timezone(&chrono::Utc),
                category: r.get(2)?,
                subject: r.get(3)?,
                action: r.get(4)?,
                data_hash: r.get(5)?,
                prev_hash: r.get(6)?,
                entry_hash: r.get(7)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Returns the sequence number of the first broken entry, or None if intact.
pub fn verify() -> AppResult<Option<u64>> {
    let entries = read_all()?;
    let mut prev = GENESIS_HASH.to_string();
    for e in &entries {
        let recomputed = AuditEntry::compute_entry_hash(
            &prev,
            &e.ts,
            &e.category,
            &e.subject,
            &e.action,
            &e.data_hash,
        );
        if e.prev_hash != prev {
            return Ok(Some(e.seq));
        }
        if recomputed != e.entry_hash {
            return Ok(Some(e.seq));
        }
        prev = e.entry_hash.clone();
    }
    Ok(None)
}

pub fn close_connection() -> AppResult<()> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    if let Some(conn) = guard.take() {
        conn.close()
            .map_err(|(_, e)| AppError::Audit(e.to_string()))?;
    }
    Ok(())
}
