//! SQLite-backed job queue for the swarm supervisor.
//!
//! Jobs survive app restarts. On startup, any jobs previously marked
//! `running` are reset to `pending` so the supervisor can resume them.

use super::types::{Job, JobStatus};
use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn queue_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Audit(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Audit(e.to_string()))?;
    Ok(dir.join("jobs.sqlite"))
}

pub fn init(app: &AppHandle) -> AppResult<Connection> {
    let path = queue_path(app)?;
    let conn = Connection::open(&path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;

         CREATE TABLE IF NOT EXISTS jobs (
            id          TEXT PRIMARY KEY,
            project_id  TEXT NOT NULL,
            query       TEXT NOT NULL,
            mode        TEXT NOT NULL,
            config      TEXT NOT NULL DEFAULT '{}',
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TEXT NOT NULL,
            started_at  TEXT,
            completed_at TEXT,
            result      TEXT,
            error       TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id);
         CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);",
    )?;

    // Reset any jobs that were running when the app crashed or was killed.
    conn.execute(
        "UPDATE jobs SET status = 'pending', started_at = NULL WHERE status = 'running'",
        [],
    )?;

    Ok(conn)
}

fn row_to_job(r: &rusqlite::Row) -> rusqlite::Result<Job> {
    let status: String = r.get(5)?;
    let status = match status.as_str() {
        "running" => JobStatus::Running,
        "completed" => JobStatus::Completed,
        "failed" => JobStatus::Failed,
        "cancelled" => JobStatus::Cancelled,
        _ => JobStatus::Pending,
    };
    Ok(Job {
        id: r.get(0)?,
        project_id: r.get(1)?,
        query: r.get(2)?,
        mode: r.get(3)?,
        config: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or_default(),
        status,
        created_at: chrono::DateTime::parse_from_rfc3339(&r.get::<_, String>(6)?)
            .map_err(|_| rusqlite::Error::InvalidQuery)?
            .with_timezone(&chrono::Utc),
        started_at: r.get::<_, Option<String>>(7)?.and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(&s)
                .ok()
                .map(|d| d.with_timezone(&chrono::Utc))
        }),
        completed_at: r.get::<_, Option<String>>(8)?.and_then(|s| {
            chrono::DateTime::parse_from_rfc3339(&s)
                .ok()
                .map(|d| d.with_timezone(&chrono::Utc))
        }),
        result: r
            .get::<_, Option<String>>(9)?
            .and_then(|s| serde_json::from_str(&s).ok()),
        error: r.get(10)?,
    })
}

pub fn insert(conn: &Connection, job: &Job) -> AppResult<()> {
    conn.execute(
        "INSERT INTO jobs (id, project_id, query, mode, config, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            job.id,
            job.project_id,
            job.query,
            job.mode,
            job.config.to_string(),
            job.status.to_string(),
            job.created_at.to_rfc3339(),
        ],
    )?;
    Ok(())
}

pub fn update_status(
    conn: &Connection,
    job_id: &str,
    status: JobStatus,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
    result: Option<serde_json::Value>,
    error: Option<String>,
) -> AppResult<()> {
    conn.execute(
        "UPDATE jobs SET status = ?1, started_at = ?2, completed_at = ?3, result = ?4, error = ?5
         WHERE id = ?6",
        params![
            status.to_string(),
            started_at.map(|d| d.to_rfc3339()),
            completed_at.map(|d| d.to_rfc3339()),
            result.map(|v| v.to_string()),
            error,
            job_id,
        ],
    )?;
    Ok(())
}

pub fn get(conn: &Connection, job_id: &str) -> AppResult<Option<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, query, mode, config, status, created_at,
                started_at, completed_at, result, error
         FROM jobs WHERE id = ?1",
    )?;
    let job = stmt
        .query_row([job_id], row_to_job)
        .optional()
        .map_err(|e| AppError::Audit(format!("job queue read: {e}")))?;
    Ok(job)
}

pub fn list_by_project(conn: &Connection, project_id: &str) -> AppResult<Vec<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, query, mode, config, status, created_at,
                started_at, completed_at, result, error
         FROM jobs WHERE project_id = ?1 ORDER BY created_at DESC",
    )?;
    let rows = stmt
        .query_map([project_id], row_to_job)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[allow(dead_code)]
pub fn list_pending(conn: &Connection) -> AppResult<Vec<Job>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, query, mode, config, status, created_at,
                started_at, completed_at, result, error
         FROM jobs WHERE status = 'pending' ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([], row_to_job)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[allow(dead_code)]
pub fn delete(conn: &Connection, job_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM jobs WHERE id = ?1", params![job_id])?;
    Ok(())
}
