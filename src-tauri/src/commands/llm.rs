//! Backend-proxied LLM HTTP. The renderer hands the URL, provider id, and
//! request headers (including the Authorization header) to Rust, which runs
//! the request through the same guard + rate-limiter + audit path as every
//! other outbound call.
//!
//! Keys themselves are not stored here — they live in the renderer (see
//! src/platform/tauri keychain bundle) and arrive per call. This module
//! never logs header values, so the key never reaches the audit log.

use crate::audit::store as audit;
use crate::crypto::sha256_hex;
use crate::error::{AppError, AppResult};
use crate::security::guard::{check, Action};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use url::Url;

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmHttpResponse {
    pub status: u16,
    pub body: String,
}

/// Authenticated GET for provider model-list endpoints.
///
/// Failure modes:
///   - InvalidInput   — url does not parse or has no host
///   - PermissionDenied — provider or host is not allowlisted
///   - Http           — transport error or non-UTF-8 body
#[tauri::command]
pub async fn llm_http_get(
    provider: String,
    url: String,
    headers: HashMap<String, String>,
) -> AppResult<LlmHttpResponse> {
    check(Action::Llm { provider: &provider })?;

    let parsed = Url::parse(&url).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("no host".into()))?
        .to_string();
    check(Action::Net { host: &host })?;

    crate::ratelimit::acquire(&host).await;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("HashCerebrum/0.1 (research-app)")
        .build()?;

    let mut request = client.get(parsed.clone());
    for (name, value) in &headers {
        request = request.header(name, value);
    }

    let response = request.send().await?;
    let status = response.status().as_u16();
    let body = response.text().await?;

    // Audit records the endpoint and size only — never the headers, which
    // carry the API key.
    let mut redacted = parsed.clone();
    redacted.set_query(None);
    let _ = audit::append(
        "llm",
        &provider,
        "models",
        &serde_json::json!({
            "url": redacted.as_str(),
            "query_hash": parsed.query().map(|q| sha256_hex(q.as_bytes())),
            "status": status,
            "bytes": body.len(),
        }),
    );

    Ok(LlmHttpResponse { status, body })
}
