//! Security layer — the gate every privileged operation passes through.
//!
//! Three sub-modules:
//!   - guard:    runtime permission gate, prompts user for sensitive actions
//!   - policy:   declarative allow/deny rules loaded at startup
//!   - denylist: host blocklist (private IP ranges, known-bad hosts)

pub mod denylist;
pub mod guard;
pub mod policy;
