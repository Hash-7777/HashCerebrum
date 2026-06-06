//! Swarm supervisor and persistent job queue.
//!
//! The supervisor is a tokio actor that manages research job lifecycle.
//! Jobs are persisted to SQLite so they survive app restarts.

pub mod job_queue;
pub mod supervisor;
pub mod types;

use crate::error::AppResult;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

/// Handle to the supervisor for Tauri commands.
pub struct SupervisorHandle {
    tx: mpsc::Sender<supervisor::SupervisorCmd>,
}

impl SupervisorHandle {
    pub async fn start_job(&self, job: types::Job) -> AppResult<String> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx
            .send(supervisor::SupervisorCmd::StartJob {
                job,
                respond_to: tx,
            })
            .await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor send: {e}")))?;
        rx.await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor recv: {e}")))?
    }

    pub async fn cancel_job(&self, job_id: String) -> AppResult<()> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx
            .send(supervisor::SupervisorCmd::CancelJob {
                job_id,
                respond_to: tx,
            })
            .await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor send: {e}")))?;
        rx.await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor recv: {e}")))?
    }

    pub async fn get_job(&self, job_id: String) -> AppResult<Option<types::Job>> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx
            .send(supervisor::SupervisorCmd::GetJob {
                job_id,
                respond_to: tx,
            })
            .await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor send: {e}")))?;
        rx.await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor recv: {e}")))?
    }

    pub async fn list_project_jobs(&self, project_id: String) -> AppResult<Vec<types::Job>> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx
            .send(supervisor::SupervisorCmd::ListProjectJobs {
                project_id,
                respond_to: tx,
            })
            .await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor send: {e}")))?;
        rx.await
            .map_err(|e| crate::error::AppError::Audit(format!("supervisor recv: {e}")))?
    }
}

/// Initialise the supervisor and return a handle for commands.
pub fn init(app: &tauri::AppHandle) -> AppResult<SupervisorHandle> {
    let conn = job_queue::init(app)?;
    let db = Arc::new(Mutex::new(conn));
    let app_handle = app.clone();

    let (tx, rx) = mpsc::channel::<supervisor::SupervisorCmd>(64);

    tauri::async_runtime::spawn(async move {
        supervisor::run(db, app_handle, rx).await;
    });

    Ok(SupervisorHandle { tx })
}
