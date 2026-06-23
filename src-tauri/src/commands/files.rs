//! Local file writing for exports. The renderer picks a destination with the
//! native save dialog (tauri-plugin-dialog, in JS), then hands the chosen path
//! and the bytes here to be written. WKWebView does not honour `<a download>`
//! for blob URLs, so this is the reliable path for saving generated PDFs,
//! manuscripts, and data exports to disk.

use crate::error::{AppError, AppResult};
use std::path::Path;

const MAX_SAVE_BYTES: usize = 100 * 1024 * 1024; // 100 MB

/// Validate a write path: reject traversal, null bytes, and sensitive system
/// directories. This is a lighter check than guard::Action::Fs (which also
/// requires PDF extension and canonicalizes) because exports may be PDF, Markdown,
/// DOCX, or other formats.
fn validate_write_path(path: &str) -> AppResult<()> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidInput("no destination path".into()));
    }
    if path.contains('\0') {
        return Err(AppError::InvalidInput("path contains null bytes".into()));
    }
    let p = Path::new(path);
    if p.components().any(|c| c.as_os_str() == "..") {
        return Err(AppError::PermissionDenied(
            "filesystem write denied: path contains '..'".into(),
        ));
    }
    // Reject absolute paths to sensitive system directories.
    let s = path.to_lowercase();
    #[cfg(unix)]
    {
        // NOTE: do NOT list "/users" or "/volumes" here. On macOS the user's
        // home — and therefore Downloads, Desktop, and Documents, the only places
        // anyone exports to — lives under /Users, and external drives mount under
        // /Volumes. Blocking those made every export silently fail. The path is
        // already chosen by the native save dialog and the OS enforces real file
        // permissions, so this list only needs to cover true OS directories.
        let sensitive = [
            "/etc",
            "/proc",
            "/sys",
            "/dev",
            "/var",
            "/usr",
            "/bin",
            "/sbin",
            "/lib",
            "/lib64",
            "/boot",
            "/root",
            "/private/etc",
            "/private/var",
            "/private/tmp",
            "/system",
            "/library",
        ];
        if sensitive.iter().any(|prefix| s.starts_with(prefix)) {
            return Err(AppError::PermissionDenied(
                "filesystem write denied: path is in a sensitive system directory".into(),
            ));
        }
    }
    #[cfg(windows)]
    {
        let drive = s
            .chars()
            .next()
            .and_then(|c| c.is_ascii_alphabetic().then_some(c));
        let drive_str = drive
            .map(|d| format!("{d}:"))
            .unwrap_or_else(|| "c:".to_string());
        let sensitive = [
            format!("{drive_str}\\windows"),
            format!("{drive_str}\\program files"),
            format!("{drive_str}\\program files (x86)"),
            format!("{drive_str}\\programdata"),
            format!("{drive_str}\\users\\all users"),
            format!("{drive_str}\\users\\default"),
            format!("{drive_str}\\windows\\system32"),
        ];
        if sensitive.iter().any(|prefix| s.starts_with(prefix)) {
            return Err(AppError::PermissionDenied(
                "filesystem write denied: path is in a sensitive system directory".into(),
            ));
        }
    }
    Ok(())
}

/// Write `bytes` to `path` (a destination the user already chose via the save
/// dialog). Bounded in size; the write runs off the async runtime thread.
#[tauri::command]
pub async fn write_file_bytes(path: String, bytes: Vec<u8>) -> AppResult<()> {
    if bytes.len() > MAX_SAVE_BYTES {
        return Err(AppError::InvalidInput("file exceeds 100 MB limit".into()));
    }
    validate_write_path(&path)?;
    tokio::task::spawn_blocking(move || std::fs::write(&path, &bytes))
        .await
        .map_err(|e| AppError::File(format!("join: {e}")))?
        .map_err(|e| AppError::File(format!("write: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_write_path;

    #[cfg(unix)]
    #[test]
    fn allows_user_home_and_volumes_exports() {
        // The reported bug: every export under the user's home was rejected.
        assert!(validate_write_path("/Users/alice/Downloads/report.pdf").is_ok());
        assert!(validate_write_path("/Users/alice/Desktop/notes.md").is_ok());
        assert!(validate_write_path("/Users/alice/Documents/paper.docx").is_ok());
        assert!(validate_write_path("/Volumes/USB/export.txt").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn still_blocks_real_system_dirs() {
        assert!(validate_write_path("/etc/passwd").is_err());
        assert!(validate_write_path("/System/Library/x").is_err());
        assert!(validate_write_path("/usr/local/bin/x").is_err());
        assert!(validate_write_path("/private/etc/hosts").is_err());
    }

    #[test]
    fn blocks_traversal_and_empty() {
        assert!(validate_write_path("../escape.txt").is_err());
        assert!(validate_write_path("/Users/a/../../etc/x").is_err());
        assert!(validate_write_path("   ").is_err());
        assert!(validate_write_path("a\0b").is_err());
    }
}
