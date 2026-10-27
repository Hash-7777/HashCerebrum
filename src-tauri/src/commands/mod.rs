//! IPC command surface — every function exposed to the renderer lives here.
//!
//! Adding a new command:
//!   1. Implement it in the appropriate submodule
//!   2. Register it in lib.rs invoke_handler!
//!   3. If it accesses external resources, route through security::guard
//!   4. Emit an audit entry for guarded actions
//!   5. Document the failure modes in the docstring

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
