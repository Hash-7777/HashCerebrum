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
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        AppError::Network(e.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Cache(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::InvalidInput(e.to_string())
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
