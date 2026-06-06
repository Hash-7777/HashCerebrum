//! Shared types for the swarm supervisor and job queue.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for JobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JobStatus::Pending => write!(f, "pending"),
            JobStatus::Running => write!(f, "running"),
            JobStatus::Completed => write!(f, "completed"),
            JobStatus::Failed => write!(f, "failed"),
            JobStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Job {
    pub id: String,
    pub project_id: String,
    pub query: String,
    pub mode: String,
    pub config: serde_json::Value,
    pub status: JobStatus,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

impl Job {
    pub fn new(
        id: impl Into<String>,
        project_id: impl Into<String>,
        query: impl Into<String>,
        mode: impl Into<String>,
        config: serde_json::Value,
    ) -> Self {
        Self {
            id: id.into(),
            project_id: project_id.into(),
            query: query.into(),
            mode: mode.into(),
            config,
            status: JobStatus::Pending,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            result: None,
            error: None,
        }
    }
}

/// Event emitted to the renderer when a job changes state.
#[derive(Debug, Clone, Serialize)]
pub struct JobEvent {
    pub job_id: String,
    pub status: JobStatus,
    pub payload: serde_json::Value,
}
