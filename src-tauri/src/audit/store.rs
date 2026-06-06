//! SQLite-backed audit log. Append-only by convention — no DELETE/UPDATE
//! statements anywhere in the codebase. Any code that *adds* one fails review.
//!
//! Encryption at rest (Phase 49.5):
//!   - Sensitive fields (category, subject, action, data_hash, payload) are
//!     encrypted with AES-256-GCM before storage.
//!   - The encryption key lives in the OS keychain and is retrieved/generated
//!     once at app startup.
//!   - Chain-verification fields (seq, ts, prev_hash, entry_hash) remain
//!     plaintext so tamper detection still works without the key.
//!   - Old entries without enc_data remain readable via plaintext fallback.

use crate::audit::chain::{AuditEntry, GENESIS_HASH};
use crate::crypto::encrypt;
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

static DB: Mutex<Option<Connection>> = Mutex::new(None);
static ENC_KEY: OnceLock<[u8; 32]> = OnceLock::new();

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

    // Schema includes enc_data for encrypted-at-rest entries.
    // Old entries without enc_data remain readable via plaintext columns.
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;

         CREATE TABLE IF NOT EXISTS audit (
            seq         INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          TEXT NOT NULL,
            category    TEXT NOT NULL DEFAULT '',
            subject     TEXT NOT NULL DEFAULT '',
            action      TEXT NOT NULL DEFAULT '',
            data_hash   TEXT NOT NULL DEFAULT '',
            prev_hash   TEXT NOT NULL,
            entry_hash  TEXT NOT NULL UNIQUE,
            enc_data    BLOB
         );
         CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
         CREATE INDEX IF NOT EXISTS idx_audit_cat ON audit(category);",
    )?;

    // Integrity check on startup — corrupt DB should be detected early
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap_or_else(|_| "unknown".into());
    if integrity != "ok" {
        tracing::error!(result = %integrity, "audit database integrity check failed");
        return Err(AppError::Audit(format!("integrity check: {integrity}")));
    }

    let key = encrypt::get_or_create_key()
        .map_err(|e| AppError::Audit(format!("encryption key init: {e}")))?;
    let _ = ENC_KEY.set(key);

    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    *guard = Some(conn);
    Ok(())
}

/// Bundle of sensitive fields encrypted as a single blob.
#[derive(serde::Serialize, serde::Deserialize)]
struct EncBundle {
    category: String,
    subject: String,
    action: String,
    data_hash: String,
    payload: String,
}

fn encrypt_bundle(
    category: &str,
    subject: &str,
    action: &str,
    data_hash: &str,
    payload: &serde_json::Value,
) -> Option<Vec<u8>> {
    let key = ENC_KEY.get()?;
    let bundle = EncBundle {
        category: category.to_string(),
        subject: subject.to_string(),
        action: action.to_string(),
        data_hash: data_hash.to_string(),
        payload: payload.to_string(),
    };
    let plaintext = serde_json::to_vec(&bundle).ok()?;
    Some(encrypt::encrypt(&plaintext, key))
}

fn decrypt_bundle(blob: Option<Vec<u8>>) -> Option<EncBundle> {
    let blob = blob?;
    let key = ENC_KEY.get()?;
    let plaintext = encrypt::decrypt(&blob, key)?;
    serde_json::from_slice(&plaintext).ok()
}

/// Build an AuditEntry from a database row, decrypting enc_data when present.
fn row_to_entry(r: &rusqlite::Row) -> rusqlite::Result<AuditEntry> {
    let ts: String = r.get(1)?;
    let enc_data: Option<Vec<u8>> = r.get(8)?;

    let (category, subject, action, data_hash) = if let Some(bundle) = decrypt_bundle(enc_data) {
        (bundle.category, bundle.subject, bundle.action, bundle.data_hash)
    } else {
        // Fallback: plaintext columns (old entries or decryption failure)
        (r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)
    };

    Ok(AuditEntry {
        seq: r.get(0)?,
        ts: chrono::DateTime::parse_from_rfc3339(&ts)
            .map_err(|_| rusqlite::Error::InvalidQuery)?
            .with_timezone(&chrono::Utc),
        category,
        subject,
        action,
        data_hash,
        prev_hash: r.get(6)?,
        entry_hash: r.get(7)?,
    })
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

    let tx = conn
        .transaction()
        .map_err(|e| AppError::Audit(format!("transaction begin: {e}")))?;

    let (prev_seq, prev_hash): (u64, String) = match tx.query_row(
        "SELECT seq, entry_hash FROM audit ORDER BY seq DESC LIMIT 1",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ) {
        Ok(row) => row,
        Err(rusqlite::Error::QueryReturnedNoRows) => (0, GENESIS_HASH.to_string()),
        Err(e) => {
            return Err(AppError::Audit(format!(
                "audit chain head read failed: {e}"
            )))
        }
    };

    let entry = AuditEntry::new(prev_seq + 1, category, subject, action, payload, prev_hash);
    let enc_data = encrypt_bundle(
        &entry.category,
        &entry.subject,
        &entry.action,
        &entry.data_hash,
        payload,
    );

    tx.execute(
        "INSERT INTO audit (ts, category, subject, action, data_hash, prev_hash, entry_hash, enc_data)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.ts.to_rfc3339(),
            // Store empty strings in plaintext columns for new encrypted entries.
            // Old entries keep their plaintext values for backward compatibility.
            if enc_data.is_some() { "" } else { &entry.category },
            if enc_data.is_some() { "" } else { &entry.subject },
            if enc_data.is_some() { "" } else { &entry.action },
            if enc_data.is_some() { "" } else { &entry.data_hash },
            entry.prev_hash,
            entry.entry_hash,
            enc_data,
        ],
    )?;
    tx.commit()
        .map_err(|e| AppError::Audit(format!("transaction commit: {e}")))?;
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
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash, enc_data
         FROM audit ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map([], row_to_entry)?
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
    let rows_i64: i64 = conn.query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0))?;
    if rows_i64 < 0 {
        return Err(AppError::Audit("negative count from SQLite".into()));
    }
    Ok(rows_i64 as u64)
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
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash, enc_data
         FROM audit ORDER BY seq ASC LIMIT ?1 OFFSET ?2",
    )?;
    let rows = stmt
        .query_map(params![limit, offset], row_to_entry)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Most recent `limit` entries in ascending sequence order. Bounds the memory
/// and IPC payload for the renderer-facing read so a very large audit log
/// cannot OOM the process; full-history access goes through read_page / verify.
pub fn read_recent(limit: u64) -> AppResult<Vec<AuditEntry>> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;
    let mut stmt = conn.prepare(
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash, enc_data
         FROM (SELECT * FROM audit ORDER BY seq DESC LIMIT ?1)
         ORDER BY seq ASC",
    )?;
    let rows = stmt
        .query_map([limit], row_to_entry)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Returns the sequence number of the first broken entry, or None if intact.
pub fn verify() -> AppResult<Option<u64>> {
    let entries = read_all()?;
    let mut prev = GENESIS_HASH.to_string();
    for e in &entries {
        let recomputed = AuditEntry::compute_entry_hash(
            e.seq,
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

pub fn connection() -> AppResult<std::sync::MutexGuard<'static, Option<Connection>>> {
    DB.lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))
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
