# Changelog

All notable changes to `lima` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This crate's version number tracks its own release history and is
independent of the Lima specification version — [Lima Core
1.0](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References
1.0](https://github.com/limaformat/lima/blob/main/docs/lima-references-1.0-spec.md)
are both frozen regardless of what this file shows.

## [0.3.0] — 2026-08-14

### Added

- Full Lima References 2.0 support: dotted document and partial paths,
  transitive three-edge resolution, cycle handling, structural copies,
  canonical interpolation, ordered diagnostics, and final resource checks.
- Primary `parse(input, ParseOptions)` entry point and `ParseMode`.
- Options-based Core parsing with duplicate-key warning callbacks.
- Structured reference diagnostic fields and References 2.0 benchmarks.

### Changed

- `parse_references` is now a deprecated alias for `parse` and has References
  2.0 semantics. References 1.0 tokens are literal text.
- `parse_core` accepts `CoreOptions`; `bool` remains supported through a
  compatibility conversion.
- Warning collection and duplicate-key lookup are bypassed entirely when no
  callback is supplied, preserving the Core hot path.
- The crate version advances to 0.3.0 to align with the TypeScript 0.3.x
  release line.
- The conformance test pins and executes all 369 shared cases: 149 Core,
  101 References 1.0, and 119 References 2.0.

## [0.1.1] — 2026-08-06

Initial release. (0.1.0 was reserved on crates.io as a placeholder with no
working implementation; this is the first version with real content.)

### Added

- `parse_core(input, strict)` — Lima Core 1.0 only, no reference
  resolution.
- `parse_references(input, options)` — Core plus the References 1.0
  extension (`($key)` document references, `(%key)` external partials).
- Zero runtime dependencies.
- Verified against the shared, implementation-independent conformance
  corpus (250 cases as of this release; count pinned by `tests/corpus.rs`)
  — see [`docs/guide.md`](https://github.com/limaformat/lima/blob/main/docs/guide.md)
  and
  [`docs/corpus-design/`](https://github.com/limaformat/lima/tree/main/docs/corpus-design).
