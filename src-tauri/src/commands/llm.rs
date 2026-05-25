//! Backend-proxied LLM HTTP. The renderer builds the URL, provider id,
//! request headers (including Authorization), and JSON body, and Rust runs
//! the request through the same guard + rate-limiter + audit path as every
//! other outbound call.
//!
//! Keys themselves are not stored here — they live in the renderer (see
//! src/platform/tauri keychain bundle) and arrive per call inside the
//! headers map. This module never logs header values, so the key never
//! reaches the audit log.

use crate::audit::store as audit;
use crate::crypto::sha256_hex;
use crate::error::{AppError, AppResult};
use crate::security::guard::{check, Action};
use dashmap::DashMap;
use futures::StreamExt;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use url::Url;

static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("HashCerebrum/0.1 (research-app)")
        .build()
        .expect("reqwest client build")
});

const MAX_BODY_BYTES: usize = 50 * 1024 * 1024; // 50 MB

static STREAM_ABORTS: Lazy<DashMap<String, Arc<AtomicBool>>> = Lazy::new(DashMap::new);

/// RAII guard that removes a stream's entry from STREAM_ABORTS when dropped,
/// regardless of how llm_chat_stream exits — success, error, or cancellation
/// by the Tauri runtime dropping the future mid-stream. Without this, a
/// dropped future leaves the entry in the map permanently, permanently
/// rejecting that stream ID on any future call.
struct StreamGuard(String);

impl Drop for StreamGuard {
    fn drop(&mut self) {
        STREAM_ABORTS.remove(&self.0);
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LlmHttpResponse {
    pub status: u16,
    pub body: String,
}

/// One streamed unit pushed to the renderer over a Tauri channel. A `line`
/// is a raw protocol line for the renderer's per-provider parser; an
/// `error` carries a redacted failure message.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum StreamEvent {
    Line { text: String },
    Error { message: String },
}

fn parse_host(url: &str) -> AppResult<(Url, String)> {
    let parsed = Url::parse(url).map_err(|e| AppError::InvalidInput(e.to_string()))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| AppError::InvalidInput("no host".into()))?
        .to_string();
    Ok((parsed, host))
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max).collect()
    }
}

/// Authenticated GET for provider model-list endpoints.
///
/// Failure modes:
///   - InvalidInput     — url does not parse or has no host
///   - PermissionDenied — provider or host is not allowlisted
///   - Http             — transport error or non-UTF-8 body
#[tauri::command]
pub async fn llm_http_get(
    provider: String,
    url: String,
    headers: HashMap<String, String>,
) -> AppResult<LlmHttpResponse> {
    check(Action::Llm {
        provider: &provider,
    })?;
    let (parsed, host) = parse_host(&url)?;
    check(Action::Net {
        host: &host,
        port: parsed.port(),
    })?;
    crate::ratelimit::acquire(&host).await;

    let mut request = HTTP_CLIENT
        .get(parsed.clone())
        .timeout(Duration::from_secs(30));
    for (name, value) in &headers {
        request = request.header(name, value);
    }

    let response = request.send().await?;
    let status = response.status().as_u16();
    if let Some(len) = response.content_length() {
        if len > MAX_BODY_BYTES as u64 {
            return Err(AppError::InvalidInput("response exceeds 50 MB".into()));
        }
    }
    let body_bytes = response.bytes().await?;
    if body_bytes.len() > MAX_BODY_BYTES {
        return Err(AppError::InvalidInput("response exceeds 50 MB".into()));
    }
    let body = String::from_utf8_lossy(&body_bytes).into_owned();

    let mut redacted = parsed.clone();
    redacted.set_query(None);
    let _ = redacted.set_username("");
    let _ = redacted.set_password(None);
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

/// Authenticated non-streaming POST for chat completions.
#[tauri::command]
pub async fn llm_http_post(
    provider: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
) -> AppResult<LlmHttpResponse> {
    check(Action::Llm {
        provider: &provider,
    })?;
    let (parsed, host) = parse_host(&url)?;
    check(Action::Net {
        host: &host,
        port: parsed.port(),
    })?;
    crate::ratelimit::acquire(&host).await;

    let mut request = HTTP_CLIENT
        .post(parsed.clone())
        .body(body)
        .timeout(Duration::from_secs(120));
    for (name, value) in &headers {
        request = request.header(name, value);
    }

    let response = request.send().await?;
    let status = response.status().as_u16();
    if let Some(len) = response.content_length() {
        if len > MAX_BODY_BYTES as u64 {
            return Err(AppError::InvalidInput("response exceeds 50 MB".into()));
        }
    }
    let resp_bytes = response.bytes().await?;
    if resp_bytes.len() > MAX_BODY_BYTES {
        return Err(AppError::InvalidInput("response exceeds 50 MB".into()));
    }
    let resp_body = String::from_utf8_lossy(&resp_bytes).into_owned();

    let mut redacted = parsed.clone();
    redacted.set_query(None);
    let _ = redacted.set_username("");
    let _ = redacted.set_password(None);
    let _ = audit::append(
        "llm",
        &provider,
        "chat",
        &serde_json::json!({
            "url": redacted.as_str(),
            "status": status,
            "bytes": resp_body.len(),
        }),
    );

    Ok(LlmHttpResponse {
        status,
        body: resp_body,
    })
}

/// Authenticated streaming POST for chat completions. Response body lines
/// are pushed to the renderer over `on_event` as they arrive; the renderer
/// keeps the per-provider line parsers. A non-2xx status or a mid-stream
/// transport failure is delivered as a `StreamEvent::Error`.
#[tauri::command]
pub async fn llm_chat_stream(
    provider: String,
    url: String,
    headers: HashMap<String, String>,
    body: String,
    stream_id: String,
    on_event: Channel<StreamEvent>,
) -> AppResult<()> {
    check(Action::Llm {
        provider: &provider,
    })?;
    let (parsed, host) = parse_host(&url)?;
    check(Action::Net {
        host: &host,
        port: parsed.port(),
    })?;
    crate::ratelimit::acquire(&host).await;

    let abort = Arc::new(AtomicBool::new(false));
    if STREAM_ABORTS.contains_key(&stream_id) {
        let _ = on_event.send(StreamEvent::Error {
            message: "duplicate stream id".into(),
        });
        return Ok(());
    }
    STREAM_ABORTS.insert(stream_id.clone(), abort.clone());
    // The guard ensures the entry is removed however this function exits —
    // success, early return, error, or a future cancellation by the runtime.
    let _guard = StreamGuard(stream_id.clone());

    let mut request = HTTP_CLIENT.post(parsed.clone()).body(body);
    for (name, value) in &headers {
        request = request.header(name, value);
    }

    let response = request.send().await?;
    let status = response.status();

    let mut redacted = parsed.clone();
    redacted.set_query(None);

    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let _ = on_event.send(StreamEvent::Error {
            message: format!("HTTP {}: {}", status.as_u16(), truncate(text.trim(), 240)),
        });
        let _ = audit::append(
            "llm",
            &provider,
            "chat-stream",
            &serde_json::json!({
                "url": redacted.as_str(),
                "status": status.as_u16(),
                "bytes": text.len(),
            }),
        );
        return Ok(()); // _guard drops here, removing the STREAM_ABORTS entry
    }

    // Buffer bytes (not strings) so a multi-byte UTF-8 char split across
    // chunk boundaries is only decoded once a full line is assembled.
    let mut stream = response.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut total: usize = 0;
    let mut channel_closed = false;
    while let Some(chunk) = stream.next().await {
        if abort.load(Ordering::Relaxed) {
            tracing::debug!(stream_id = %stream_id, "chat stream aborted");
            break;
        }
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let _ = on_event.send(StreamEvent::Error {
                    message: format!("stream error: {e}"),
                });
                break;
            }
        };
        total += chunk.len();
        if total > MAX_BODY_BYTES {
            let _ = on_event.send(StreamEvent::Error {
                message: "stream exceeded 50 MB".into(),
            });
            break;
        }
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = buf.drain(..=pos).collect();
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim();
            if !trimmed.is_empty()
                && on_event
                    .send(StreamEvent::Line {
                        text: trimmed.to_string(),
                    })
                    .is_err()
            {
                channel_closed = true;
                break;
            }
        }
        if channel_closed || abort.load(Ordering::Relaxed) {
            break;
        }
    }
    if !abort.load(Ordering::Relaxed) && !buf.is_empty() {
        let text = String::from_utf8_lossy(&buf);
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            let _ = on_event.send(StreamEvent::Line {
                text: trimmed.to_string(),
            });
        }
    }

    // _guard drops at end of function, removing the STREAM_ABORTS entry.

    let _ = audit::append(
        "llm",
        &provider,
        "chat-stream",
        &serde_json::json!({
            "url": redacted.as_str(),
            "status": status.as_u16(),
            "bytes": total,
        }),
    );

    Ok(())
}

#[tauri::command]
pub fn llm_chat_stream_abort(stream_id: String) {
    if let Some(flag) = STREAM_ABORTS.get(&stream_id) {
        flag.store(true, Ordering::Relaxed);
        tracing::debug!(stream_id = %stream_id, "abort flag set");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn abort_flag_is_set_and_removed() {
        let id = "test-abort-1".to_string();
        STREAM_ABORTS.insert(id.clone(), Arc::new(AtomicBool::new(false)));
        llm_chat_stream_abort(id.clone());
        {
            let flag = STREAM_ABORTS.get(&id).unwrap();
            assert!(flag.load(Ordering::Relaxed));
        }
        STREAM_ABORTS.remove(&id);
    }

    #[test]
    fn abort_unknown_stream_id_is_noop() {
        llm_chat_stream_abort("nonexistent-id".to_string());
    }
}
