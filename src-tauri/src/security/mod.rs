//! Security layer — the gate every privileged operation passes through.
//!
//! Sub-modules:
//!   - guard:    runtime permission gate, prompts user for sensitive actions
//!   - policy:   declarative allow/deny rules loaded at startup
//!   - denylist: host blocklist (private IP ranges, known-bad hosts)
//!   - resolver: DNS resolver that drops private IPs for public hosts

pub mod denylist;
pub mod guard;
pub mod policy;
pub mod resolver;
