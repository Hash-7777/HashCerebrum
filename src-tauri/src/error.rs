use serde::Serialize;
use thiserror::Error;

/// Top-level error type returned across the IPC boundary.
///
/// Tauri serializes the `Display` impl, which means errors crossing into
/// JS only show the *message* — never internal state. Any sensitive field
/// (paths, keys, tokens) must be redacted in the Display impl.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[allow(dead_code)]
    #[error("rate limit exceeded for host: {0}")]
    RateLimited(String),

    #[error("network error: {0}")]
    Network(String),

    #[error("keychain error: {0}")]
    Keychain(String),

    #[error("audit log error: {0}")]
    Audit(String),

    #[error("cache error: {0}")]
    Cache(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("internal error")]
    Internal,

    #[error("pdf error: {0}")]
    Pdf(String),
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        tracing::error!(error = %e, "network error");
        AppError::Network("upstream request failed".into())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Cache(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        tracing::error!(error = %e, "json parse error");
        AppError::InvalidInput("malformed JSON payload".into())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal // do not leak path/errno across IPC
            .tap(|_| tracing::error!(error = %e, "io error"))
    }
}

// Helper trait for inline side-effects without disturbing the value
trait Tap: Sized {
    fn tap<F: FnOnce(&Self)>(self, f: F) -> Self {
        f(&self);
        self
    }
}
impl<T> Tap for T {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_error_is_generic() {
        let err = AppError::Network("upstream request failed".into());
        assert_eq!(err.to_string(), "network error: upstream request failed");
    }

    #[test]
    fn serde_error_does_not_leak_content() {
        let inner: serde_json::Error = serde_json::from_str::<serde_json::Value>("{bad").unwrap_err();
        let app_err: AppError = inner.into();
        let msg = app_err.to_string();
        assert!(!msg.contains("bad"), "raw content should not leak in message: {msg}");
        assert_eq!(msg, "invalid input: malformed JSON payload");
    }
}
