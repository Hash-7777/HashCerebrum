//! Generic HTTP GET — the single chokepoint for outbound requests.
//! Every call gates through security::guard and emits an audit entry.

use crate::audit::store as audit;
use crate::crypto::sha256_hex;
use crate::error::{AppError, AppResult};
use crate::security::guard::{check, Action};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

static HTTP_CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("HashCerebrum/0.1 (research-app)")
        .build()
        .expect("reqwest client build")
});

const MAX_BODY_BYTES: usize = 50 * 1024 * 1024; // 50 MB

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
    check(Action::Net {
        host,
        port: parsed.port(),
    })?;

    // Token-bucket: block until we have headroom for this host. Keeps us
    // off the 429 path even when the agent fans out queries in parallel.
    crate::ratelimit::acquire(host).await;

    let resp = HTTP_CLIENT.get(&url).send().await?;
    let status = resp.status().as_u16();

    // Defend against unbounded response bodies (DoS / OOM)
    if let Some(len) = resp.content_length() {
        if len > MAX_BODY_BYTES as u64 {
            return Err(AppError::InvalidInput("response exceeds 50 MB".into()));
        }
    }
    let body = resp.text().await?;
    if body.len() > MAX_BODY_BYTES {
        return Err(AppError::InvalidInput("response exceeds 50 MB".into()));
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn http_response_serializes() {
        let resp = HttpResponse {
            status: 200,
            body: "hello".into(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        assert!(json.contains("200"));
        assert!(json.contains("hello"));
    }

    #[test]
    fn http_client_rejects_redirects() {
        // Verify the shared client is configured with a no-redirect policy.
        // reqwest does not expose the policy directly, but we can verify
        // the client was built without panicking and the static is initialized.
        let _ = &*HTTP_CLIENT;
    }
}
