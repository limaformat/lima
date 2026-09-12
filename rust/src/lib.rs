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
//! [`parse_core`] implements Lima Core 1.0 in full (block/flow sequences
//! and mappings, dates, numbers, quoting, `|` literal block scalars).
//! [`parse`] implements References 2.0 on top of it. [`parse_references`]
//! remains as a deprecated alias with identical 2.0 semantics.
//!
//! See <https://limaformat.dev> for the specification, and the
//! TypeScript implementation (`@limaformat/lima` on npm) for a second,
//! independently maintained reference.
//!
//! ## Conformance
//!
//! Checked against the shared, language-neutral conformance corpus: 211
//! Lima Core 1.0 cases (a byte-frozen 149-case 1.0.0 baseline plus
//! additive errata through 1.0.9), 136 References 2.0 cases, and the
//! 101-case frozen References 1.0 corpus — a regression target only; its
//! resolver is not part of the published crate. All counts are pinned by
//! the test suite.

pub mod block;
mod block_cursor;
mod block_scalar;
mod chars;
pub mod core;
pub mod errors;
pub mod flow;
pub mod normalize;
#[cfg(test)]
mod references;
pub mod references2;
pub mod scalars;
pub mod value;

pub use crate::core::{parse_core, CoreOptions};
pub use crate::errors::Diagnostic;
#[allow(deprecated)]
pub use crate::references2::{parse, parse_references, ParseMode, ParseOptions, ReferencesOptions};
