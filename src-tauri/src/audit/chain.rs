//! Hash-chain primitives.
//!
//! Entry hash = SHA-256(prev_hash || timestamp || category || subject || data_hash)
//! data_hash  = SHA-256(serialized payload) — keeps the chain small while
//! still proving payload integrity via a second-stage hash.

use crate::crypto::sha256_hex;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub seq: u64,
    pub ts: DateTime<Utc>,
    pub category: String, // "net" | "keychain" | "fs" | "llm" | "agent"
    pub subject: String,  // host / key / path / provider / agent name
    pub action: String,   // "allow" | "deny" | "store" | "retrieve" | "delete" | "invoke"
    pub data_hash: String,
    pub prev_hash: String,
    pub entry_hash: String,
}

impl AuditEntry {
    pub fn new(
        seq: u64,
        category: impl Into<String>,
        subject: impl Into<String>,
        action: impl Into<String>,
        payload: &serde_json::Value,
        prev_hash: impl Into<String>,
    ) -> Self {
        let category = category.into();
        let subject = subject.into();
        let action = action.into();
        let prev_hash = prev_hash.into();
        let ts = Utc::now();
        let data_hash = sha256_hex(payload.to_string().as_bytes());
        let to_hash = format!("{prev_hash}|{ts}|{category}|{subject}|{action}|{data_hash}");
        let entry_hash = sha256_hex(to_hash.as_bytes());
        Self {
            seq,
            ts,
            category,
            subject,
            action,
            data_hash,
            prev_hash,
            entry_hash,
        }
    }
}

pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
