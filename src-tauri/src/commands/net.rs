//! Generic HTTP GET — the single chokepoint for outbound requests.
//! Every call gates through security::guard and emits an audit entry.

use crate::audit::store as audit;
use crate::crypto::sha256_hex;
use crate::error::{AppError, AppResult};
use crate::security::guard::{check, Action};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

#[tauri::command]
pub async fn net_get(url: String) -> AppResult<HttpResponse> {
    let parsed = Url::parse(&url).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("no host".into()))?;
    check(Action::Net { host })?;

    // Token-bucket: block until we have headroom for this host. Keeps us
    // off the 429 path even when the agent fans out queries in parallel.
    crate::ratelimit::acquire(host).await;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("HashCerebrum/0.1 (research-app)")
        .build()?;

    let resp = client.get(&url).send().await?;
    let status = resp.status().as_u16();
    let body = resp.text().await?;
    let mut redacted = parsed.clone();
    redacted.set_query(None);

    let _ = audit::append(
        "net",
        host,
        "get",
        &serde_json::json!({
            "url": redacted.as_str(),
            "query_hash": parsed.query().map(|q| sha256_hex(q.as_bytes())),
            "status": status,
            "bytes": body.len()
        }),
    );

    Ok(HttpResponse { status, body })
}
