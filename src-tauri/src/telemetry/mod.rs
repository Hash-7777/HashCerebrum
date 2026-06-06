//! Local OpenTelemetry-style tracing for agent swarm execution.
//! Writes spans to a local SQLite table with parent-child relationships.
//! No external telemetry endpoints — all data stays on device.

use crate::error::{AppError, AppResult};
use chrono::Utc;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

static DB: Mutex<Option<Connection>> = Mutex::new(None);

fn trace_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::InvalidInput(e.to_string()))?;
    std::fs::create_dir_all(&dir).ok();
    Ok(dir.join("traces.sqlite"))
}

pub fn init(app: &AppHandle) -> AppResult<()> {
    let path = trace_path(app)?;
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         CREATE TABLE IF NOT EXISTS traces (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            trace_id    TEXT NOT NULL,
            parent_id   INTEGER,
            name        TEXT NOT NULL,
            started_at  TEXT NOT NULL,
            ended_at    TEXT,
            status      TEXT,
            attributes  TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_trace_id ON traces(trace_id);
         CREATE INDEX IF NOT EXISTS idx_parent ON traces(parent_id);",
    )?;
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex: {e}")))?;
    *guard = Some(conn);
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TraceSpan {
    pub id: i64,
    pub trace_id: String,
    pub parent_id: Option<i64>,
    pub name: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub status: String,
    pub attributes: Option<String>,
}

pub fn start_span(
    trace_id: String,
    parent_id: Option<i64>,
    name: String,
    attributes: Option<String>,
) -> AppResult<i64> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Cache("traces not initialised".into()))?;
    conn.execute(
        "INSERT INTO traces (trace_id, parent_id, name, started_at, status, attributes)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            trace_id,
            parent_id,
            name,
            Utc::now().to_rfc3339(),
            "ok",
            attributes
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn end_span(span_id: i64, status: String) -> AppResult<()> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Cache("traces not initialised".into()))?;
    conn.execute(
        "UPDATE traces SET ended_at = ?1, status = ?2 WHERE id = ?3",
        params![Utc::now().to_rfc3339(), status, span_id],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn trace_read(trace_id: Option<String>) -> AppResult<Vec<TraceSpan>> {
    let mut guard = DB
        .lock()
        .map_err(|e| AppError::Cache(format!("mutex: {e}")))?;
    let conn = guard
        .as_mut()
        .ok_or(AppError::Cache("traces not initialised".into()))?;
    let sql = if trace_id.is_some() {
        "SELECT id, trace_id, parent_id, name, started_at, ended_at, status, attributes
         FROM traces WHERE trace_id = ?1 ORDER BY started_at"
    } else {
        "SELECT id, trace_id, parent_id, name, started_at, ended_at, status, attributes
         FROM traces ORDER BY started_at DESC LIMIT 200"
    };
    let mut stmt = conn.prepare(sql)?;
    let params_slice: &[&dyn rusqlite::ToSql] = match trace_id.as_ref() {
        Some(t) => &[t],
        None => &[],
    };
    let rows = stmt.query_map(params_slice, |r| {
        Ok(TraceSpan {
            id: r.get(0)?,
            trace_id: r.get(1)?,
            parent_id: r.get(2)?,
            name: r.get(3)?,
            started_at: r.get(4)?,
            ended_at: r.get(5)?,
            status: r.get(6)?,
            attributes: r.get(7)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}
