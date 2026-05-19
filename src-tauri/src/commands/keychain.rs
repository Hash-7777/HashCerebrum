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
const MAX_SECRET_LEN: usize = 8192;
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

fn validate_secret(value: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(AppError::InvalidInput("api key is empty".into()));
    }
    if value.len() > MAX_SECRET_LEN {
        return Err(AppError::InvalidInput("api key is too long".into()));
    }
    if value.chars().any(|c| c.is_control()) {
        return Err(AppError::InvalidInput(
            "api key contains invalid control characters".into(),
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn store_secret(key: &str, value: &str) -> AppResult<()> {
    security_framework::passwords::set_generic_password(SERVICE, key, value.as_bytes())
        .map_err(|e| AppError::Keychain(e.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn store_secret(key: &str, value: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| AppError::Keychain(e.to_string()))?;
    entry
        .set_password(value)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

#[cfg(target_os = "macos")]
fn retrieve_secret(key: &str) -> AppResult<Option<String>> {
    match security_framework::passwords::get_generic_password(SERVICE, key) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(Some)
            .map_err(|_| AppError::Keychain("keychain item is not valid UTF-8".into())),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn retrieve_secret(key: &str) -> AppResult<Option<String>> {
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

#[cfg(target_os = "macos")]
fn delete_secret(key: &str) -> AppResult<()> {
    match security_framework::passwords::delete_generic_password(SERVICE, key) {
        Ok(()) => Ok(()),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn delete_secret(key: &str) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| AppError::Keychain(e.to_string()))?;
    let _ = entry.delete_credential();
    Ok(())
}

#[tauri::command]
pub async fn keychain_store(key: String, value: String) -> AppResult<()> {
    check(Action::Keychain { key: &key })?;
    validate_secret(&value)?;
    store_secret(&key, &value)?;
    let _ = audit::append("keychain", &key, "store", &serde_json::Value::Null);
    Ok(())
}

#[tauri::command]
pub async fn keychain_retrieve(key: String) -> AppResult<Option<String>> {
    check(Action::Keychain { key: &key })?;
    let value = retrieve_secret(&key)?;
    if value.is_some() {
        let _ = audit::append("keychain", &key, "retrieve", &serde_json::Value::Null);
    }
    Ok(value)
}

#[tauri::command]
pub async fn keychain_delete(key: String) -> AppResult<()> {
    check(Action::Keychain { key: &key })?;
    delete_secret(&key)?;
    let _ = audit::append("keychain", &key, "delete", &serde_json::Value::Null);
    Ok(())
}
