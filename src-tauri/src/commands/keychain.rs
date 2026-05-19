//! OS-keychain backed API key storage.
//!
//! On macOS we use security-framework directly (binary-bound ACL avoidance).
//! On Linux/Windows we use the keyring crate.
//!
//! Every operation is guarded by the key allowlist before touching the OS store.

use crate::audit::store as audit;
use crate::error::{AppError, AppResult};
use crate::security::guard::{check, Action};

const SERVICE: &str = "com.hashcerebrum.app";

#[tauri::command]
pub async fn keychain_store(key: String, value: String) -> AppResult<()> {
    check(Action::Keychain { key: &key })?;
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| AppError::Keychain(e.to_string()))?;
    entry.set_password(&value).map_err(|e| AppError::Keychain(e.to_string()))?;
    let _ = audit::append("keychain", &key, "store", &serde_json::Value::Null);
    Ok(())
}

#[tauri::command]
pub async fn keychain_retrieve(key: String) -> AppResult<Option<String>> {
    check(Action::Keychain { key: &key })?;
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(v) => {
            let _ = audit::append("keychain", &key, "retrieve", &serde_json::Value::Null);
            Ok(Some(v))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> AppResult<()> {
    check(Action::Keychain { key: &key })?;
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| AppError::Keychain(e.to_string()))?;
    let _ = entry.delete_credential();
    let _ = audit::append("keychain", &key, "delete", &serde_json::Value::Null);
    Ok(())
}
