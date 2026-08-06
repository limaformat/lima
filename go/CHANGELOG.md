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

## [Unreleased]

Initial implementation. Not yet tagged — see `go/README.md` for install
instructions once a `go/vX.Y.Z` tag exists.

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
