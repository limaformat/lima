//! # lima
//!
//! **LIMA Is Metadata Annotation** — a small, predictable frontmatter
//! parser. A deliberate, focused subset of YAML: the part frontmatter
//! actually needs, with well-defined types, no surprises, and zero runtime
//! dependencies.
//!
//! ```
//! use lima::{parse_references, ReferencesOptions};
//!
//! let result = parse_references(
//!     "title: Hello World\npublished: 2024-03-01\ndraft: false\n",
//!     ReferencesOptions::default(),
//! ).unwrap();
//! ```
//!
//! [`parse_core`] implements Lima Core 1.0 in full (block/flow sequences
//! and mappings, dates, numbers, quoting, `|` literal block scalars).
//! [`parse_references`] implements References 1.0 on top of it (document
//! and partial references, string interpolation, two-phase
//! forward/backward resolution).
//!
//! See <https://limaformat.dev> for the specification, and the
//! TypeScript implementation (`@limaformat/lima` on npm) for a second,
//! independently maintained reference.
//!
//! ## Conformance
//!
//! Checked against the **entire** shared conformance corpus
//! (`tests/corpus.rs`: 250 of 250 cases across both specs, 0 failing, 0
//! skipped). See each module's doc comment for scoped-down corners
//! relative to the TS source that don't affect conformance (mainly: no
//! `WeakMap`-equivalent memoization in `references.rs` — a performance
//! optimization, not a behavior).

pub mod block;
mod block_cursor;
mod chars;
pub mod core;
pub mod errors;
pub mod flow;
pub mod normalize;
pub mod references;
pub mod scalars;
pub mod value;

pub use crate::core::parse_core;
pub use crate::references::{parse_references, ReferencesOptions};
