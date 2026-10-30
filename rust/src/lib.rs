#![allow(clippy::result_large_err)]
//! # lima
//!
//! **LIMA Is Metadata Annotation** — a small, predictable frontmatter
//! parser. A deliberate, focused subset of YAML: the part frontmatter
//! actually needs, with well-defined types, no surprises, and zero runtime
//! dependencies.
//!
//! ```
//! use lima::{parse, ParseOptions};
//!
//! let result = parse(
//!     "title: Hello World\npublished: 2024-03-01\ndraft: false\n",
//!     ParseOptions::default(),
//! ).unwrap();
//! ```
//!
//! [`parse_core`] implements Lima Core 1.2 in full (block/flow sequences
//! and mappings, dates, numbers, quoting, `|` literal block scalars).
//! [`parse`] implements References 2.1 on top of it. [`parse_references`]
//! remains as a deprecated alias with identical 2.1 semantics.
//!
//! See <https://limaformat.dev> for the specification, and the
//! TypeScript implementation (`@limaformat/lima` on npm) for a second,
//! independently maintained reference.
//!
//! ## Conformance
//!
//! Checked against the shared, language-neutral conformance corpus through
//! Lima Core 1.2 and References 2.1 (including the additive 1.2/2.1 suites),
//! plus the frozen References 1.0 corpus. The Core 1.0/1.1 and References 1.0
//! baselines remain count- and hash-pinned by their corpus manifests.

pub mod block;
mod block_cursor;
mod block_scalar;
mod chars;
pub mod core;
pub mod errors;
pub mod flow;
mod key_hints;
pub mod normalize;
#[cfg(test)]
mod references;
pub mod references2;
pub mod scalars;
mod structure;
mod unicode_key;
mod unicode_key_table;
pub mod value;

pub use crate::core::{parse_core, CoreOptions};
pub use crate::errors::Diagnostic;
#[allow(deprecated)]
pub use crate::references2::{parse, parse_references, ParseMode, ParseOptions, ReferencesOptions};
