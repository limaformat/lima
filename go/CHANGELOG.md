# Changelog

All notable changes to `github.com/limaformat/lima/go` are documented in
this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This module's version number tracks its own release history and is
independent of the Lima specification version — [Lima Core
1.0](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References
1.0](https://github.com/limaformat/lima/blob/main/docs/lima-references-1.0-spec.md)
are both frozen regardless of what this file shows.

## [0.3.0] — 2026-08-14

### Added

- Full Lima References 2.0 support, including dotted paths, three-edge
  transitive resolution, cycles, structural copies, canonical interpolation,
  ordered diagnostics, and final resource validation.
- Primary `Parse(input, ParseOptions)` entry point and `ParseMode`.
- Core and References duplicate-key warning callbacks.
- References 2.0 conformance and performance scenarios.

### Changed

- `ParseReferences` is now the deprecated References 2.0 alias for `Parse`.
- The complete 369-case corpus is pinned: 149 Core, 101 References 1.0, and
  119 References 2.0, with zero skipped cases.
- The release line advances to `go/v0.3.0` to align with TypeScript and Rust.

## [0.1.0] — 2026-08-07

Initial release, tagged as `go/v0.1.0`.

### Added

- `ParseCore(input, strict)` — Lima Core 1.0 only, no reference
  resolution.
- `ParseReferences(input, options)` — Core plus the References 1.0
  extension (`($key)` document references, `(%key)` external partials).
- Zero runtime dependencies.
- Verified against the shared, implementation-independent conformance
  corpus (250 cases as of this release; count pinned by
  `corpus_test.go`) — see
  [`docs/guide.md`](https://github.com/limaformat/lima/blob/main/docs/guide.md)
  and
  [`docs/corpus-design/`](https://github.com/limaformat/lima/tree/main/docs/corpus-design).
