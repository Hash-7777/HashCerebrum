//! Swarm supervisor — tokio actor that manages research job lifecycle.
//!
//! The supervisor runs in a dedicated tokio task and communicates via
//! mpsc channels. It:
//!   - Accepts jobs from the renderer
//!   - Persists them to the SQLite job queue
//!   - Spawns specialist tasks for each job
//!   - Emits progress events back to the renderer via Tauri
//!
//! Design note: Specialist execution is currently a stub that simulates
//! progress. In a future phase, each specialist will run its own tool loop
//! against the medical-source APIs.

use super::job_queue;
use super::types::{Job, JobEvent, JobStatus};
use crate::error::AppResult;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::sync::{mpsc, Mutex};

/// Commands sent to the supervisor.
pub enum SupervisorCmd {
    StartJob {
        job: Job,
        respond_to: tokio::sync::oneshot::Sender<AppResult<String>>,
    },
    CancelJob {
        job_id: String,
        respond_to: tokio::sync::oneshot::Sender<AppResult<()>>,
    },
    GetJob {
        job_id: String,
        respond_to: tokio::sync::oneshot::Sender<AppResult<Option<Job>>>,
    },
    ListProjectJobs {
        project_id: String,
        respond_to: tokio::sync::oneshot::Sender<AppResult<Vec<Job>>>,
    },
    Shutdown,
}

/// Shared state for the supervisor.
struct SupervisorState {
    db: Arc<Mutex<Connection>>,
    app_handle: tauri::AppHandle,
    /// Tracks active job handles so they can be cancelled.
    active: HashMap<String, tokio::task::JoinHandle<()>>,
}

impl SupervisorState {
    async fn start_job(&mut self, job: Job) -> AppResult<String> {
        let conn = self.db.lock().await;
        job_queue::insert(&conn, &job)?;
        drop(conn);

        let job_id = job.id.clone();
        let db = self.db.clone();
        let app = self.app_handle.clone();

        // Spawn the job as an independent tokio task.
        let handle = tokio::spawn(async move {
            if let Err(e) = run_job(&db, &app, job).await {
                tracing::error!(error = %e, "job execution failed");
            }
        });

        self.active.insert(job_id.clone(), handle);
        Ok(job_id)
    }

    async fn cancel_job(&mut self, job_id: &str) -> AppResult<()> {
        if let Some(handle) = self.active.remove(job_id) {
            handle.abort();
            let conn = self.db.lock().await;
            job_queue::update_status(
                &conn,
                job_id,
                JobStatus::Cancelled,
                None,
                Some(chrono::Utc::now()),
                None,
                None,
            )?;
        }
        Ok(())
    }
}

/// Simulate a specialist-run job. In a full implementation this would:
///   1. Query medical sources (PubMed, Europe PMC, etc.)
///   2. Extract evidence
///   3. Run consensus voting
///   4. Synthesize a manuscript via the boss agent
async fn run_job(db: &Arc<Mutex<Connection>>, app: &tauri::AppHandle, job: Job) -> AppResult<()> {
    let job_id = job.id.clone();

    // Mark as running.
    {
        let conn = db.lock().await;
        job_queue::update_status(
            &conn,
            &job_id,
            JobStatus::Running,
            Some(chrono::Utc::now()),
            None,
            None,
            None,
        )?;
    }
    emit_event(
        app,
        &job_id,
        JobStatus::Running,
        serde_json::json!({"step": "started", "query": job.query}),
    );

    // Phase 1 — source sweep (simulated).
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    emit_event(
        app,
        &job_id,
        JobStatus::Running,
        serde_json::json!({"step": "sources", "sources": ["pubmed", "europepmc", "openalex"]}),
    );

    // Phase 2 — evidence extraction (simulated).
    tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    emit_event(
        app,
        &job_id,
        JobStatus::Running,
        serde_json::json!({"step": "evidence", "count": 12}),
    );

    // Phase 3 — consensus (simulated).
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
    emit_event(
        app,
        &job_id,
        JobStatus::Running,
        serde_json::json!({"step": "consensus", "confidence": 0.87}),
    );

    // Phase 4 — synthesis (simulated).
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    // Mark as completed.
    let result = serde_json::json!({
        "manuscript_url": format!("hashcerebrum://manuscript/{job_id}"),
        "evidence_count": 12,
        "sources": ["pubmed", "europepmc", "openalex"],
    });
    {
        let conn = db.lock().await;
        job_queue::update_status(
            &conn,
            &job_id,
            JobStatus::Completed,
            None,
            Some(chrono::Utc::now()),
            Some(result.clone()),
            None,
        )?;
    }
    emit_event(app, &job_id, JobStatus::Completed, result);
    Ok(())
}

fn emit_event(app: &tauri::AppHandle, job_id: &str, status: JobStatus, payload: serde_json::Value) {
    let event = JobEvent {
        job_id: job_id.to_string(),
        status,
        payload,
    };
    let _ = app.emit("swarm:job_event", event);
}

/// Run the supervisor event loop.
pub async fn run(
    db: Arc<Mutex<Connection>>,
    app_handle: tauri::AppHandle,
    mut rx: mpsc::Receiver<SupervisorCmd>,
) {
    let mut state = SupervisorState {
        db,
        app_handle,
        active: HashMap::new(),
    };

    while let Some(cmd) = rx.recv().await {
        match cmd {
            SupervisorCmd::StartJob { job, respond_to } => {
                let result = state.start_job(job).await;
                let _ = respond_to.send(result);
            }
            SupervisorCmd::CancelJob { job_id, respond_to } => {
                let result = state.cancel_job(&job_id).await;
                let _ = respond_to.send(result);
            }
            SupervisorCmd::GetJob { job_id, respond_to } => {
                let conn = state.db.lock().await;
                let result = job_queue::get(&conn, &job_id);
                let _ = respond_to.send(result);
            }
            SupervisorCmd::ListProjectJobs {
                project_id,
                respond_to,
            } => {
                let conn = state.db.lock().await;
                let result = job_queue::list_by_project(&conn, &project_id);
                let _ = respond_to.send(result);
            }
            SupervisorCmd::Shutdown => break,
        }
    }

    // Abort any remaining active jobs on shutdown.
    for (_, handle) in state.active.drain() {
        handle.abort();
    }
}
