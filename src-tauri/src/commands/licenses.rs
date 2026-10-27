//! The licence documents that ship in the app's resource folder, read for the
//! in-app Licenses view.
//!
//! The renderer names a document by a fixed enum, never by path: there are
//! exactly three readable files, and `resource_name` is the only place a name
//! is produced. Nothing the renderer sends reaches the filesystem.
//!
//! Failure modes: a missing or unreadable resource (a build that did not carry
//! it) and a file over the size cap both return a `File` error with no path in
//! the message.

use crate::error::{AppError, AppResult};
use serde::Deserialize;
use tauri::Manager;

/// The notices file is the big one; the cap is well clear of it and still far
/// below anything that could trouble the renderer.
const MAX_DOCUMENT_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseDocument {
    /// The app's own licence.
    Project,
    /// Every dependency with its version and declared licence.
    Inventory,
    /// The third-party copyright and permission notices.
    Notices,
}

fn resource_name(document: LicenseDocument) -> &'static str {
    match document {
        LicenseDocument::Project => "LICENSE",
        LicenseDocument::Inventory => "THIRDPARTY-LICENSES.md",
        LicenseDocument::Notices => "THIRDPARTY-NOTICES.md",
    }
}

#[tauri::command]
pub async fn read_license_document(
    app: tauri::AppHandle,
    document: LicenseDocument,
) -> AppResult<String> {
    let name = resource_name(document);
    let path = app
        .path()
        .resolve(name, tauri::path::BaseDirectory::Resource)
        .map_err(|e| {
            tracing::error!(error = %e, document = name, "licence resource not resolvable");
            AppError::File("licence document is not in this build".into())
        })?;

    let size = tokio::fs::metadata(&path)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, document = name, "licence resource unreadable");
            AppError::File("licence document is not in this build".into())
        })?
        .len();
    if size > MAX_DOCUMENT_BYTES {
        tracing::error!(document = name, size, "licence resource over the size cap");
        return Err(AppError::File(
            "licence document is too large to read".into(),
        ));
    }

    tokio::fs::read_to_string(&path).await.map_err(|e| {
        tracing::error!(error = %e, document = name, "licence resource read failed");
        AppError::File("licence document could not be read".into())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_document_maps_to_a_bundled_resource() {
        // These three names are what tauri.conf.json ships in the resource
        // folder. If one is renamed there, this test is the reminder.
        assert_eq!(resource_name(LicenseDocument::Project), "LICENSE");
        assert_eq!(
            resource_name(LicenseDocument::Inventory),
            "THIRDPARTY-LICENSES.md"
        );
        assert_eq!(
            resource_name(LicenseDocument::Notices),
            "THIRDPARTY-NOTICES.md"
        );
    }

    #[test]
    fn names_are_plain_file_names_with_no_path_of_their_own() {
        for document in [
            LicenseDocument::Project,
            LicenseDocument::Inventory,
            LicenseDocument::Notices,
        ] {
            let name = resource_name(document);
            assert!(!name.contains('/'), "{name} must not carry a path");
            assert!(!name.contains('\\'), "{name} must not carry a path");
            assert!(!name.contains(".."), "{name} must not carry a path");
        }
    }

    #[test]
    fn the_renderer_can_only_ask_for_the_three_documents() {
        // The document is deserialised from the IPC payload, so a name the
        // renderer invents must not parse into anything.
        assert!(serde_json::from_str::<LicenseDocument>("\"notices\"").is_ok());
        assert!(serde_json::from_str::<LicenseDocument>("\"inventory\"").is_ok());
        assert!(serde_json::from_str::<LicenseDocument>("\"project\"").is_ok());
        assert!(serde_json::from_str::<LicenseDocument>("\"../../etc/passwd\"").is_err());
        assert!(serde_json::from_str::<LicenseDocument>("\"LICENSE\"").is_err());
    }
}
