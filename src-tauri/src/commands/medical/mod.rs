//! Medical-source fetchers. Each module wraps one upstream API,
//! parses to a normalized shape, and writes provenance via audit.
//!
//! All implementations route through commands::net::net_get and inherit
//! its guard + audit guarantees.

pub mod ctgov;
pub mod europepmc;
pub mod openalex;
pub mod openfda;
pub mod pubmed;
pub mod rxnorm;
