//! AES-256-GCM encryption for audit-log payload at rest.
//!
//! Key lifecycle:
//!   1. On first app startup, generate a random 256-bit key.
//!   2. Store the key in the OS keychain under a fixed service+account.
//!   3. On subsequent startups, retrieve the existing key.
//!   4. The key never leaves Rust memory.
//!
//! Format: nonce (12 bytes) || ciphertext || tag (16 bytes)

use crate::error::{AppError, AppResult};
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};

const SERVICE: &str = "com.hashcerebrum.app";
const KEY_ACCOUNT: &str = "audit.encryption";

#[cfg(target_os = "macos")]
fn keychain_get(key: &str) -> AppResult<Option<Vec<u8>>> {
    match security_framework::passwords::get_generic_password(SERVICE, key) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.code() == -25300 => Ok(None), // errSecItemNotFound
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
fn keychain_get(key: &str) -> AppResult<Option<Vec<u8>>> {
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| AppError::Keychain(e.to_string()))?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v.into_bytes())),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(AppError::Keychain(e.to_string())),
    }
}

#[cfg(target_os = "macos")]
fn keychain_set(key: &str, value: &[u8]) -> AppResult<()> {
    security_framework::passwords::set_generic_password(SERVICE, key, value)
        .map_err(|e| AppError::Keychain(e.to_string()))
}

#[cfg(not(target_os = "macos"))]
fn keychain_set(key: &str, value: &[u8]) -> AppResult<()> {
    let entry = keyring::Entry::new(SERVICE, key).map_err(|e| AppError::Keychain(e.to_string()))?;
    entry
        .set_password(&String::from_utf8_lossy(value))
        .map_err(|e| AppError::Keychain(e.to_string()))
}

/// Retrieve the existing audit encryption key or create a new random one.
pub fn get_or_create_key() -> AppResult<[u8; 32]> {
    if let Some(bytes) = keychain_get(KEY_ACCOUNT)? {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Ok(key);
        }
        tracing::warn!("audit encryption key in keychain has wrong length; regenerating");
    }

    let mut key = [0u8; 32];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
    keychain_set(KEY_ACCOUNT, &key)?;
    tracing::info!("generated new audit encryption key and stored in OS keychain");
    Ok(key)
}

/// Encrypt plaintext with AES-256-GCM.
/// Returns: nonce (12 bytes) || ciphertext || tag (16 bytes).
pub fn encrypt(plaintext: &[u8], key: &[u8; 32]) -> Vec<u8> {
    let cipher = Aes256Gcm::new_from_slice(key).expect("AES-256-GCM accepts 32-byte keys");
    let nonce_bytes: [u8; 12] = rand::random();
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .expect("encryption should not fail with valid key and nonce");
    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    out
}

/// Decrypt a blob produced by `encrypt`.
/// Returns None if the ciphertext is too short or authentication fails.
pub fn decrypt(blob: &[u8], key: &[u8; 32]) -> Option<Vec<u8>> {
    if blob.len() < 28 {
        // 12-byte nonce + 16-byte minimum ciphertext (which includes tag)
        return None;
    }
    let cipher = Aes256Gcm::new_from_slice(key).ok()?;
    let nonce = Nonce::from_slice(&blob[..12]);
    cipher.decrypt(nonce, &blob[12..]).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_decrypt() {
        let key = [42u8; 32];
        let plaintext = b"sensitive audit payload";
        let encrypted = encrypt(plaintext, &key);
        assert!(encrypted.len() > plaintext.len());
        let decrypted = decrypt(&encrypted, &key).expect("decrypt should succeed");
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let key = [42u8; 32];
        let wrong_key = [43u8; 32];
        let encrypted = encrypt(b"secret", &key);
        assert!(decrypt(&encrypted, &wrong_key).is_none());
    }

    #[test]
    fn decrypt_tampered_ciphertext_fails() {
        let key = [42u8; 32];
        let mut encrypted = encrypt(b"secret", &key);
        encrypted[20] ^= 0xFF; // flip a bit in the ciphertext region
        assert!(decrypt(&encrypted, &key).is_none());
    }

    #[test]
    fn decrypt_short_input_returns_none() {
        let key = [42u8; 32];
        assert!(decrypt(b"short", &key).is_none());
        assert!(decrypt(&[], &key).is_none());
    }
}
