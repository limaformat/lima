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
//! Checked against the **entire** shared conformance corpus
//! (all 149 Core, 101 frozen References 1.0, and 119 References 2.0 cases —
//! 369 cases in total, with counts pinned by integration and private unit
//! tests).

pub mod block;
mod block_cursor;
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
