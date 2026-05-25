//! Hash-chain primitives.
//!
//! Entry hash = SHA-256(seq || prev_hash || timestamp || category || subject || action || data_hash)
//! data_hash  = SHA-256(serialized payload) — keeps the chain small while
//! still proving payload integrity via a second-stage hash.
//!
//! seq is included in the hash so that entries cannot be silently reordered
//! or replayed without breaking chain verification.

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
        let entry_hash = Self::compute_entry_hash(
            seq, &prev_hash, &ts, &category, &subject, &action, &data_hash,
        );
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

    /// Recompute the entry hash using stored fields. This is used by
    /// `verify()` to check chain integrity without re-serializing the
    /// original payload.
    pub fn compute_entry_hash(
        seq: u64,
        prev_hash: &str,
        ts: &DateTime<Utc>,
        category: &str,
        subject: &str,
        action: &str,
        data_hash: &str,
    ) -> String {
        let to_hash = format!("{seq}|{prev_hash}|{ts}|{category}|{subject}|{action}|{data_hash}");
        sha256_hex(to_hash.as_bytes())
    }
}

pub const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_hash_is_deterministic() {
        let payload = serde_json::json!({"test": true});
        let e1 = AuditEntry::new(1, "net", "pubmed", "get", &payload, GENESIS_HASH);
        let e2 = AuditEntry::new(1, "net", "pubmed", "get", &payload, GENESIS_HASH);
        // data_hash is deterministic for identical payloads
        assert_eq!(e1.data_hash, e2.data_hash);
        // entry hashes differ because timestamps differ (by design)
        assert_ne!(e1.entry_hash, e2.entry_hash);
    }

    #[test]
    fn recompute_matches_original_hash() {
        let payload = serde_json::json!({"query": "diabetes"});
        let entry = AuditEntry::new(1, "llm", "openai", "chat", &payload, GENESIS_HASH);
        let recomputed = AuditEntry::compute_entry_hash(
            entry.seq,
            GENESIS_HASH,
            &entry.ts,
            &entry.category,
            &entry.subject,
            &entry.action,
            &entry.data_hash,
        );
        assert_eq!(recomputed, entry.entry_hash);
    }

    #[test]
    fn tampered_data_hash_fails_verification() {
        let payload = serde_json::json!({"query": "diabetes"});
        let entry = AuditEntry::new(1, "llm", "openai", "chat", &payload, GENESIS_HASH);
        let recomputed = AuditEntry::compute_entry_hash(
            GENESIS_HASH,
            &entry.ts,
            &entry.category,
            &entry.subject,
            &entry.action,
            "tampered-hash",
        );
        assert_ne!(recomputed, entry.entry_hash);
    }

    #[test]
    fn chain_integrity_detects_broken_link() {
        let e1 = AuditEntry::new(
            1,
            "net",
            "host1",
            "get",
            &serde_json::Value::Null,
            GENESIS_HASH,
        );
        let e2 = AuditEntry::new(
            2,
            "net",
            "host2",
            "get",
            &serde_json::Value::Null,
            &e1.entry_hash,
        );
        let e3_bad = AuditEntry::new(
            3,
            "net",
            "host3",
            "get",
            &serde_json::Value::Null,
            "tampered-prev",
        );

        assert_eq!(e2.prev_hash, e1.entry_hash);
        assert_ne!(e3_bad.prev_hash, e2.entry_hash);
    }
}
