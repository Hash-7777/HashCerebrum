//! Per-host token bucket rate limiter. Defaults are conservative —
//! tune per source per upstream's stated limits.
//!
//! Implementation deferred to Phase 4. Stub keeps the module surface stable.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[allow(dead_code)]
struct Bucket {
    tokens: f64,
    last: Instant,
    rate: f64,    // tokens per second
    capacity: f64,
}

#[allow(dead_code)]
static BUCKETS: Mutex<Option<HashMap<String, Bucket>>> = Mutex::new(None);

#[allow(dead_code)]
pub fn allow(_host: &str) -> bool {
    // TODO Phase 4 — implement token bucket
    let _ = &BUCKETS;
    true
}
