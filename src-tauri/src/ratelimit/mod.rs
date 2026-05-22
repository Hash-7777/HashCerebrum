//! Per-host token-bucket rate limiter.
//!
//! Each medical source upstream publishes its own rate ceiling
//! (PubMed: 3 r/s without API key, 10 with; ClinicalTrials.gov: ~5 r/s;
//! OpenAlex: 10 r/s polite pool). We model each as a token bucket with
//! a refill rate and a capacity, and consume one token per outbound
//! request. If the bucket is empty, the caller backs off until it
//! refills.
//!
//! The buckets live in a global lazy-initialized `Mutex<HashMap>` —
//! shared across every Tauri command. Defaults are intentionally
//! conservative; we'd rather throttle ourselves than be 429'd.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Clone, Copy)]
struct BucketSpec {
    /// Refill in tokens per second.
    rate: f64,
    /// Maximum simultaneous burst.
    capacity: f64,
}

#[derive(Clone, Copy)]
struct Bucket {
    tokens: f64,
    last_refill: Instant,
    spec: BucketSpec,
}

impl Bucket {
    fn new(spec: BucketSpec) -> Self {
        Self {
            tokens: spec.capacity,
            last_refill: Instant::now(),
            spec,
        }
    }

    /// Try to take one token. Returns the duration the caller should
    /// wait if the bucket is empty (Some) or `None` if the request can
    /// proceed immediately.
    fn try_take(&mut self) -> Option<Duration> {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last_refill).as_secs_f64();
        self.tokens = (self.tokens + elapsed * self.spec.rate).min(self.spec.capacity);
        self.last_refill = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            None
        } else {
            // How long until we accrue one full token at the current rate?
            let deficit = 1.0 - self.tokens;
            let wait_secs = deficit / self.spec.rate;
            Some(Duration::from_secs_f64(wait_secs.max(0.05)))
        }
    }
}

fn default_spec(host: &str) -> BucketSpec {
    // Match published polite-pool rates where they exist.
    match host {
        h if h.contains("eutils.ncbi.nlm.nih.gov") => BucketSpec { rate: 3.0, capacity: 6.0 },
        h if h.contains("clinicaltrials.gov") => BucketSpec { rate: 5.0, capacity: 10.0 },
        h if h.contains("api.openalex.org") => BucketSpec { rate: 10.0, capacity: 20.0 },
        h if h.contains("europepmc.org") => BucketSpec { rate: 5.0, capacity: 10.0 },
        h if h.contains("api.fda.gov") => BucketSpec { rate: 4.0, capacity: 8.0 },
        h if h.contains("rxnav.nlm.nih.gov") => BucketSpec { rate: 5.0, capacity: 10.0 },
        // Conservative default for any host that didn't get a specific bucket.
        _ => BucketSpec { rate: 2.0, capacity: 5.0 },
    }
}

fn buckets() -> &'static Mutex<HashMap<String, Bucket>> {
    static B: OnceLock<Mutex<HashMap<String, Bucket>>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Acquire one token for `host`. Blocks (via tokio sleep) if the bucket
/// is empty. Always returns once the token is consumed.
pub async fn acquire(host: &str) {
    loop {
        let wait = {
            let mut guard = buckets().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            let bucket = guard
                .entry(host.to_string())
                .or_insert_with(|| Bucket::new(default_spec(host)));
            bucket.try_take()
        };
        match wait {
            None => return,
            Some(d) => tokio::time::sleep(d).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn bucket_drains_and_refills() {
        // Drain a small bucket fast, then confirm subsequent requests wait.
        let host = "test-drain.example";
        for _ in 0..5 {
            acquire(host).await;
        }
        let started = Instant::now();
        acquire(host).await;
        // Default for unknown hosts is capacity=5 and rate=2/s; the sixth
        // request should wait for a refill.
        assert!(started.elapsed() >= Duration::from_millis(300));
    }
}
