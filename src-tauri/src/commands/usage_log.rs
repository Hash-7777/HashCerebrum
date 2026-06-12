//! Append-only token-usage log for the HashMeter ecosystem.
//!
//! Every model response records ONE JSON line — token counts only, never any
//! message content — to `usage.jsonl` in the app data dir. HashMeterAi reads
//! this file to report HashCerebrum usage as MEASURED (not estimated), exactly
//! as it reads Claude Code / Kimi transcripts.
//!
//! Privacy: a line carries a UTC timestamp, the model id, and token/cost
//! counts — nothing about the prompt, the answer, or the user. The file lives
//! in the app data dir (resolved at runtime, never a hard-coded path), so the
//! integration works on any user's machine.

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::io::Write;
use tauri::Manager;

/// One usage record. The field names ARE the on-disk JSON contract shared with
/// HashCortx and consumed by HashMeterAi — do not rename without updating both.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageRecord {
    /// ISO-8601 UTC timestamp of the response.
    pub ts: String,
    /// Model id that produced the response.
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
    #[serde(default)]
    pub cost: f64,
}

/// Serialize a record to its single JSONL line, trailing newline included.
fn usage_line(record: &UsageRecord) -> AppResult<String> {
    let json = serde_json::to_string(record)?;
    Ok(format!("{json}\n"))
}

/// Append one usage record to `usage.jsonl` in the app data dir. Creates the
/// directory and file on first write. Append-only — it never rewrites history,
/// and never blocks the async runtime (the write runs on a blocking thread).
#[tauri::command]
pub async fn usage_log_append(app: tauri::AppHandle, record: UsageRecord) -> AppResult<()> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::File("could not resolve app data dir".into()))?;
    let line = usage_line(&record)?;
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        std::fs::create_dir_all(&dir)?;
        let path = dir.join("usage.jsonl");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        file.write_all(line.as_bytes())
    })
    .await
    .map_err(|e| AppError::File(format!("join: {e}")))??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_is_compact_json_with_newline() {
        let rec = UsageRecord {
            ts: "2026-06-12T01:22:09Z".into(),
            model: "gemini-3.5-flash".into(),
            input_tokens: 4120,
            output_tokens: 880,
            cache_read: 0,
            cache_write: 0,
            cost: 0.0,
        };
        let line = usage_line(&rec).unwrap();
        assert!(line.ends_with('\n'));
        assert!(line.contains("\"input_tokens\":4120"));
        assert!(line.contains("\"output_tokens\":880"));
        assert!(line.contains("\"model\":\"gemini-3.5-flash\""));
        // Hard guarantee: the log line never carries message content.
        assert!(!line.contains("content"));
    }

    #[test]
    fn deserializes_with_optional_fields_defaulted() {
        let line = r#"{"ts":"t","model":"m","input_tokens":10,"output_tokens":5}"#;
        let rec: UsageRecord = serde_json::from_str(line).unwrap();
        assert_eq!(rec.input_tokens, 10);
        assert_eq!(rec.output_tokens, 5);
        assert_eq!(rec.cache_read, 0);
        assert_eq!(rec.cache_write, 0);
        assert_eq!(rec.cost, 0.0);
    }
}
