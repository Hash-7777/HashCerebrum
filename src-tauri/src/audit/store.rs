//! SQLite-backed audit log. Append-only for individual entries — the only
//! bulk mutations are retention pruning (drops a contiguous prefix of the
//! oldest rows), the explicit `reset()` (clears the log to a fresh chain), and
//! `redact_and_rechain()` (the user-invoked project erasure, which overwrites
//! the naming fields and re-hashes the chain so it still verifies).
//!
//! Storage model:
//!   - Entries are stored in plain text on the local machine (app-data dir).
//!     The log only ever holds activity metadata — category, subject (host /
//!     provider / key name), action, a one-way SHA-256 of the payload, plus the
//!     chain fields (seq, ts, prev_hash, entry_hash). It never stores API keys
//!     or the content of queries/answers, so there is nothing secret at rest.
//!   - The hash chain makes the log *tamper-evident* (any edit, reorder, or
//!     deletion breaks `verify()`), not *tamper-proof* — the hash is unkeyed,
//!     so it is not encrypted and requires no OS keychain access.
//!   - The legacy `enc_data` column is retained so databases written by the
//!     short-lived encrypted-at-rest build still open; it is no longer written.

use crate::audit::chain::{AuditEntry, GENESIS_HASH};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

// ---------------------------------------------------------------------------
// Async wrappers (E1: RUST-002)
// All SQLite ops run on tokio's spawn_blocking pool so the sync std::Mutex
// never blocks an async worker thread under parallel load.
// ---------------------------------------------------------------------------

pub async fn append_async(
    category: String,
    subject: String,
    action: String,
    payload: serde_json::Value,
) -> AppResult<AuditEntry> {
    tokio::task::spawn_blocking(move || append(&category, &subject, &action, &payload))
        .await
        .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

pub async fn read_recent_async(limit: u64) -> AppResult<Vec<AuditEntry>> {
    tokio::task::spawn_blocking(move || read_recent(limit))
        .await
        .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

pub async fn read_page_async(offset: u64, limit: u64) -> AppResult<Vec<AuditEntry>> {
    tokio::task::spawn_blocking(move || read_page(offset, limit))
        .await
        .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

pub async fn count_async() -> AppResult<u64> {
    tokio::task::spawn_blocking(count)
        .await
        .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

pub async fn verify_async() -> AppResult<Option<u64>> {
    tokio::task::spawn_blocking(verify)
        .await
        .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

pub async fn reset_async() -> AppResult<()> {
    tokio::task::spawn_blocking(reset)
        .await
        .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

/// Run a closure with the global connection on the blocking thread pool.
pub async fn with_connection_async<F, R>(f: F) -> AppResult<R>
where
    F: FnOnce(&mut Connection) -> AppResult<R> + Send + 'static,
    R: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        let mut guard = DB
            .lock()
            .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
        let conn = guard
            .as_mut()
            .ok_or(AppError::Audit("not initialized".into()))?;
        f(conn)
    })
    .await
    .map_err(|e| AppError::Audit(format!("spawn_blocking: {e}")))?
}

static DB: Mutex<Option<Connection>> = Mutex::new(None);

/// Retention cap. After each append the oldest rows beyond this many are
/// pruned so the log cannot grow without bound. ~5000 metadata rows is a few
/// MB at most; the surviving tail stays internally chained, and `verify()`
/// anchors on the new head, so pruning never reports a false break.
const MAX_ENTRIES: u64 = 5000;

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

    ensure_schema(&conn)?;

    // Integrity check on startup — corrupt DB should be detected early
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .unwrap_or_else(|_| "unknown".into());
    if integrity != "ok" {
        tracing::error!(result = %integrity, "audit database integrity check failed");
        return Err(AppError::Audit(format!("integrity check: {integrity}")));
    }

    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    *guard = Some(conn);
    Ok(())
}

/// Create the audit table if needed and migrate older databases forward.
///
/// `CREATE TABLE IF NOT EXISTS` does NOT add a new column to a table that
/// already exists, so a database created before encryption-at-rest (which added
/// `enc_data`) would be missing that column — and every read selecting it would
/// fail with "no such column: enc_data" surfaced as "cache error: database
/// operation failed". The migration adds the column idempotently. Pure with
/// respect to the passed connection so it can be exercised against an in-memory
/// database in tests.
fn ensure_schema(conn: &Connection) -> AppResult<()> {
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

    // Forward-migrate a pre-encryption database that lacks the enc_data column.
    let has_enc_data = {
        let mut stmt = conn
            .prepare("PRAGMA table_info(audit)")
            .map_err(|e| AppError::Audit(format!("table_info: {e}")))?;
        let names = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| AppError::Audit(format!("table_info query: {e}")))?;
        let mut found = false;
        for name in names {
            if name.map_err(|e| AppError::Audit(format!("table_info row: {e}")))? == "enc_data" {
                found = true;
                break;
            }
        }
        found
    };
    if !has_enc_data {
        conn.execute("ALTER TABLE audit ADD COLUMN enc_data BLOB", [])
            .map_err(|e| AppError::Audit(format!("enc_data migration: {e}")))?;
    }
    Ok(())
}

/// Build an AuditEntry from a plaintext database row.
///
/// Rows written by the short-lived encrypted build stored their sensitive
/// fields only inside `enc_data`, leaving these columns blank; such rows read
/// back with empty category/subject/action.
fn row_to_entry(r: &rusqlite::Row) -> rusqlite::Result<AuditEntry> {
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
    append_conn(conn, category, subject, action, payload)
}

/// Append against an explicit connection. Public path locks the global DB and
/// delegates here; tests drive it against an in-memory connection.
fn append_conn(
    conn: &mut Connection,
    category: &str,
    subject: &str,
    action: &str,
    payload: &serde_json::Value,
) -> AppResult<AuditEntry> {
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

    tx.execute(
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

    prune_to(&tx, MAX_ENTRIES)?;

    tx.commit()
        .map_err(|e| AppError::Audit(format!("transaction commit: {e}")))?;
    Ok(entry)
}

/// Keep only the most recent `keep` rows, dropping the oldest contiguous
/// prefix. A no-op when the log holds `keep` rows or fewer (the OFFSET subquery
/// yields no seq, and `seq <= NULL` matches nothing).
fn prune_to(conn: &Connection, keep: u64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM audit WHERE seq <= (
            SELECT seq FROM audit ORDER BY seq DESC LIMIT 1 OFFSET ?1
         )",
        params![keep],
    )?;
    Ok(())
}

/// Redact every entry naming `subject_like`, then re-chain the log so
/// `verify()` still reports intact.
///
/// The re-chain is the whole point. `entry_hash` covers category, subject,
/// action, and data_hash, so overwriting those four with a redaction marker and
/// leaving the stored hash behind makes every redacted row fail recomputation —
/// and because each entry links to the previous one, the break propagates to
/// the end of the log. Erasing one project would otherwise leave the user's
/// tamper-evidence permanently reporting corruption, which destroys its ability
/// to reveal any *later* tampering. So redacted rows are re-hashed and every
/// following row is re-linked.
///
/// This does not weaken the threat model. The chain is already documented as
/// tamper-*evident*, not tamper-proof: the hash is unkeyed, so anyone able to
/// write the database could re-chain it too. What the chain detects is an
/// outside edit; an erasure the user asked for is not one, and the caller
/// appends a tombstone recording that a redaction happened and when.
///
/// `subject_like` is matched as a substring against category, subject, and
/// action. It is passed as a LIKE pattern with `\` as the escape character, so
/// callers must escape `%` and `_` in the term itself — a project id may
/// legitimately contain `_`, which would otherwise act as a single-character
/// wildcard and redact unrelated entries.
///
/// Returns the number of rows redacted.
pub(crate) fn redact_and_rechain(conn: &mut Connection, subject_like: &str) -> AppResult<u64> {
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Audit(format!("redact transaction: {e}")))?;

    let redacted = "[REDACTED]";
    let pattern = format!("%{subject_like}%");
    let count = tx.execute(
        "UPDATE audit SET category = ?1, subject = ?1, action = ?1, data_hash = ?1, enc_data = NULL
         WHERE subject LIKE ?2 ESCAPE '\\'
            OR action LIKE ?2 ESCAPE '\\'
            OR category LIKE ?2 ESCAPE '\\'",
        params![redacted, pattern],
    )?;

    if count > 0 {
        // Re-link and re-hash the whole log in sequence order. Walking from the
        // start keeps this simple and correct: untouched rows re-hash to exactly
        // the value already stored, so only the redacted rows and everything
        // after them actually change.
        let entries = {
            let mut stmt = tx.prepare(
                "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash
                 FROM audit ORDER BY seq ASC",
            )?;
            let rows = stmt
                .query_map([], row_to_entry)?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        // The first retained entry is the trust anchor — keep its prev_hash as
        // stored, exactly as verify_entries treats it, so a pruned tail does not
        // turn into a false break here either.
        let mut prev_hash: Option<String> = None;
        for entry in &entries {
            let linked_prev = prev_hash.unwrap_or_else(|| entry.prev_hash.clone());
            let entry_hash = AuditEntry::compute_entry_hash(
                entry.seq,
                &linked_prev,
                &entry.ts,
                &entry.category,
                &entry.subject,
                &entry.action,
                &entry.data_hash,
            );
            if linked_prev != entry.prev_hash || entry_hash != entry.entry_hash {
                tx.execute(
                    "UPDATE audit SET prev_hash = ?1, entry_hash = ?2 WHERE seq = ?3",
                    params![linked_prev, entry_hash, entry.seq],
                )?;
            }
            prev_hash = Some(entry_hash);
        }
    }

    tx.commit()
        .map_err(|e| AppError::Audit(format!("redact commit: {e}")))?;
    Ok(count as u64)
}

/// Clear the log to a fresh chain. The next append re-seeds from GENESIS, so
/// `verify()` reports intact. Used to retire a legacy chain (e.g. entries
/// written under an older hash format or the encrypted build) on user request.
pub fn reset() -> AppResult<()> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;
    reset_conn(conn)
}

fn reset_conn(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "DELETE FROM audit;
         DELETE FROM sqlite_sequence WHERE name = 'audit';",
    )
    .map_err(|e| AppError::Audit(format!("reset failed: {e}")))?;
    Ok(())
}

pub fn read_all() -> AppResult<Vec<AuditEntry>> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Audit(format!("mutex poisoned: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Audit("not initialized".into()))?;
    read_all_conn(conn)
}

fn read_all_conn(conn: &Connection) -> AppResult<Vec<AuditEntry>> {
    let mut stmt = conn.prepare(
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash
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
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash
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
        "SELECT seq, ts, category, subject, action, data_hash, prev_hash, entry_hash
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
    Ok(verify_entries(&read_all()?))
}

/// Pure chain check over an ordered slice. Each entry's hash is recomputed from
/// its own stored `prev_hash`, and consecutive entries must link
/// (`entry[i].prev_hash == entry[i-1].entry_hash`). The first entry is the
/// trust anchor: its `prev_hash` is accepted as-is (GENESIS for a full chain,
/// or the pruned predecessor's hash for a retained tail), so retention never
/// reports a false break.
fn verify_entries(entries: &[AuditEntry]) -> Option<u64> {
    let mut expected_prev: Option<&str> = None;
    for e in entries {
        if let Some(prev) = expected_prev {
            if e.prev_hash != prev {
                return Some(e.seq);
            }
        }
        let recomputed = AuditEntry::compute_entry_hash(
            e.seq,
            &e.prev_hash,
            &e.ts,
            &e.category,
            &e.subject,
            &e.action,
            &e.data_hash,
        );
        if recomputed != e.entry_hash {
            return Some(e.seq);
        }
        expected_prev = Some(&e.entry_hash);
    }
    None
}

#[allow(dead_code)]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_pre_encryption_database_missing_enc_data() {
        let conn = Connection::open_in_memory().unwrap();
        // Recreate the OLD schema (before encryption-at-rest) — no enc_data column.
        conn.execute_batch(
            "CREATE TABLE audit (
                seq         INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          TEXT NOT NULL,
                category    TEXT NOT NULL DEFAULT '',
                subject     TEXT NOT NULL DEFAULT '',
                action      TEXT NOT NULL DEFAULT '',
                data_hash   TEXT NOT NULL DEFAULT '',
                prev_hash   TEXT NOT NULL,
                entry_hash  TEXT NOT NULL UNIQUE
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO audit (ts, prev_hash, entry_hash) VALUES ('2026-01-01T00:00:00Z', 'GENESIS', 'h1')",
            [],
        )
        .unwrap();

        // The migration must add enc_data without dropping the existing row.
        ensure_schema(&conn).unwrap();

        // A read that selects enc_data (which previously failed) now succeeds.
        let enc: Option<Vec<u8>> = conn
            .query_row("SELECT enc_data FROM audit WHERE seq = 1", [], |r| r.get(0))
            .unwrap();
        assert!(enc.is_none());
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn ensure_schema_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        // A second call must not error (column already present).
        ensure_schema(&conn).unwrap();
        assert!(conn.prepare("SELECT enc_data FROM audit").is_ok());
    }

    // Full store -> read -> verify round-trip through a real connection. This is
    // the cover the previous tests lacked: chain.rs's recompute test reused the
    // in-memory entry and never went through SQLite, so a divergence between
    // what `append` writes (timestamp serialization, hash inputs) and what
    // `verify` recomputes — exactly the failure that surfaced as
    // "chain broken at seq 1" — went undetected.
    #[test]
    fn append_read_verify_round_trip_is_intact() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();

        let hosts = [
            "clinicaltrials.gov",
            "eutils.ncbi.nlm.nih.gov",
            "www.ebi.ac.uk",
        ];
        for host in hosts {
            append_conn(
                &mut conn,
                "net",
                host,
                "get",
                &serde_json::json!({ "host": host }),
            )
            .unwrap();
        }

        let entries = read_all_conn(&conn).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].prev_hash, GENESIS_HASH);
        assert_eq!(entries[1].prev_hash, entries[0].entry_hash);
        // The chain a fresh plaintext log produces must verify clean.
        assert_eq!(verify_entries(&entries), None);
    }

    // A retained tail (oldest rows pruned) no longer starts at GENESIS, but its
    // surviving entries still link to one another. verify() must anchor on the
    // first surviving entry rather than report a false break at seq 1.
    #[test]
    fn verify_anchors_on_first_surviving_entry_after_pruning() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        for i in 0..5 {
            append_conn(
                &mut conn,
                "net",
                &format!("host{i}"),
                "get",
                &serde_json::Value::Null,
            )
            .unwrap();
        }
        // Drop the genesis-rooted prefix, mimicking retention pruning.
        conn.execute("DELETE FROM audit WHERE seq <= 2", [])
            .unwrap();

        let tail = read_all_conn(&conn).unwrap();
        assert_eq!(tail.len(), 3);
        assert_ne!(tail[0].prev_hash, GENESIS_HASH);
        assert_eq!(verify_entries(&tail), None);
    }

    // Sanity: a tampered field must break verification at that entry.
    #[test]
    fn verify_detects_tampered_entry() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        for i in 0..3 {
            append_conn(
                &mut conn,
                "net",
                &format!("host{i}"),
                "get",
                &serde_json::Value::Null,
            )
            .unwrap();
        }
        let mut entries = read_all_conn(&conn).unwrap();
        entries[1].subject = "tampered.example.com".into();
        assert_eq!(verify_entries(&entries), Some(entries[1].seq));
    }

    #[test]
    fn prune_keeps_newest_rows_and_tail_verifies() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        for i in 0..6 {
            append_conn(
                &mut conn,
                "net",
                &format!("host{i}"),
                "get",
                &serde_json::Value::Null,
            )
            .unwrap();
        }
        prune_to(&conn, 3).unwrap();
        let tail = read_all_conn(&conn).unwrap();
        assert_eq!(tail.len(), 3);
        assert_eq!(
            tail.iter().map(|e| e.seq).collect::<Vec<_>>(),
            vec![4, 5, 6]
        );
        assert_eq!(verify_entries(&tail), None);
        // Pruning below the row count is a no-op.
        prune_to(&conn, 10).unwrap();
        assert_eq!(read_all_conn(&conn).unwrap().len(), 3);
    }

    /// The regression this guards: redaction overwrote the four fields that
    /// `entry_hash` is computed from and left the stored hash behind, so a user
    /// who erased one project was left with an audit log that reported itself
    /// corrupted from that point on — and could no longer reveal real tampering.
    #[test]
    fn redaction_erases_the_named_project_and_the_chain_still_verifies() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        for subject in [
            "pubmed",
            "proj-alpha",
            "openalex",
            "proj-alpha",
            "api.fda.gov",
        ] {
            append_conn(&mut conn, "net", subject, "get", &serde_json::Value::Null).unwrap();
        }

        let count = redact_and_rechain(&mut conn, "proj-alpha").unwrap();
        assert_eq!(count, 2, "both entries naming the project are redacted");

        let entries = read_all_conn(&conn).unwrap();
        assert_eq!(
            verify_entries(&entries),
            None,
            "erasing a project must not leave the log reporting corruption"
        );
        assert!(
            !entries.iter().any(|e| e.subject.contains("proj-alpha")),
            "the erased project must not remain readable in the log"
        );
        // Entries belonging to other work keep their real subjects.
        assert!(entries.iter().any(|e| e.subject == "pubmed"));
        assert!(entries.iter().any(|e| e.subject == "api.fda.gov"));
        // Redaction rewrites in place; it never drops rows.
        assert_eq!(entries.len(), 5);
    }

    #[test]
    fn redaction_of_an_underscored_id_leaves_a_similar_project_alone() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        // `_` is a LIKE single-character wildcard: unescaped, "trial_1" also
        // matches "trialX1" and would erase a project the user never named.
        for subject in ["trial_1", "trialX1"] {
            append_conn(&mut conn, "net", subject, "get", &serde_json::Value::Null).unwrap();
        }

        let count = redact_and_rechain(&mut conn, "trial\\_1").unwrap();
        assert_eq!(count, 1);

        let entries = read_all_conn(&conn).unwrap();
        assert!(entries.iter().any(|e| e.subject == "trialX1"));
        assert!(!entries.iter().any(|e| e.subject == "trial_1"));
        assert_eq!(verify_entries(&entries), None);
    }

    #[test]
    fn redacting_nothing_leaves_the_log_byte_identical() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        for i in 0..4 {
            append_conn(
                &mut conn,
                "net",
                &format!("host{i}"),
                "get",
                &serde_json::Value::Null,
            )
            .unwrap();
        }
        let before = read_all_conn(&conn).unwrap();

        let count = redact_and_rechain(&mut conn, "no-such-project").unwrap();
        assert_eq!(count, 0);

        let after = read_all_conn(&conn).unwrap();
        assert_eq!(
            before
                .iter()
                .map(|e| e.entry_hash.clone())
                .collect::<Vec<_>>(),
            after
                .iter()
                .map(|e| e.entry_hash.clone())
                .collect::<Vec<_>>(),
            "a purge that matches nothing must not rewrite any hash"
        );
        assert_eq!(verify_entries(&after), None);
    }

    #[test]
    fn reset_clears_to_a_fresh_chain() {
        let mut conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        for i in 0..4 {
            append_conn(
                &mut conn,
                "net",
                &format!("host{i}"),
                "get",
                &serde_json::Value::Null,
            )
            .unwrap();
        }
        reset_conn(&conn).unwrap();
        assert!(read_all_conn(&conn).unwrap().is_empty());
        // The next append re-seeds from GENESIS at seq 1, and the chain verifies.
        append_conn(
            &mut conn,
            "net",
            "fresh.example.com",
            "get",
            &serde_json::Value::Null,
        )
        .unwrap();
        let entries = read_all_conn(&conn).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].seq, 1);
        assert_eq!(entries[0].prev_hash, GENESIS_HASH);
        assert_eq!(verify_entries(&entries), None);
    }
}
