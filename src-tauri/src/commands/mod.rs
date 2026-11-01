//! IPC command surface — every function exposed to the renderer lives here.
//!
//! Adding a new command:
//!   1. Implement it in the appropriate submodule
//!   2. Register it in lib.rs invoke_handler!
//!   3. If it accesses external resources, route through security::guard
//!   4. Emit an audit entry for guarded actions
//!   5. Document the failure modes in the docstring

/// What every outbound request calls itself.
///
/// Built from the crate version so a release cannot ship a version string that
/// is one behind the app, and written once so the two HTTP clients cannot
/// drift apart. Public biomedical sources ask callers to identify themselves
/// and give a way to be reached; this is that.
pub const USER_AGENT: &str = concat!(
    "HashCerebrum/",
    env!("CARGO_PKG_VERSION"),
    " (research-app; mailto:support@hashcerebrum.com)"
);

#[cfg(test)]
mod tests {
    #[test]
    fn the_user_agent_carries_the_crate_version() {
        let expected = format!("HashCerebrum/{}", env!("CARGO_PKG_VERSION"));
        assert!(
            super::USER_AGENT.starts_with(&expected),
            "{} does not start with {expected}",
            super::USER_AGENT
        );
        assert!(super::USER_AGENT.contains("mailto:"));
    }
}

pub mod audit;
pub mod cache;
pub mod files;
pub mod licenses;
pub mod llm;
pub mod manuscript;
pub mod medical;
pub mod net;
pub mod notch;
pub mod pdf;
pub mod purge;
pub mod swarm;
pub mod usage_log;
