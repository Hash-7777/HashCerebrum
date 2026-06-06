//! Tauri commands for the swarm supervisor and job queue.

use crate::error::AppResult;
use crate::swarm::types::Job;
use crate::swarm::SupervisorHandle;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct StartJobRequest {
    pub project_id: String,
    pub query: String,
    pub mode: String,
    #[serde(default)]
    pub config: serde_json::Value,
}

#[tauri::command]
pub async fn swarm_start_job(
    handle: State<'_, SupervisorHandle>,
    req: StartJobRequest,
) -> AppResult<String> {
    let job = Job::new(
        uuid::Uuid::new_v4().to_string(),
        req.project_id,
        req.query,
        req.mode,
        req.config,
    );
    let job_id = handle.start_job(job).await?;
    Ok(job_id)
}

#[tauri::command]
pub async fn swarm_cancel_job(
    handle: State<'_, SupervisorHandle>,
    job_id: String,
) -> AppResult<()> {
    handle.cancel_job(job_id).await
}

#[tauri::command]
pub async fn swarm_get_job(
    handle: State<'_, SupervisorHandle>,
    job_id: String,
) -> AppResult<Option<Job>> {
    handle.get_job(job_id).await
}

#[tauri::command]
pub async fn swarm_list_jobs(
    handle: State<'_, SupervisorHandle>,
    project_id: String,
) -> AppResult<Vec<Job>> {
    handle.list_project_jobs(project_id).await
}
