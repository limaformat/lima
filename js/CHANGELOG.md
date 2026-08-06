# Changelog

All notable changes to `@limaformat/lima` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This package's version number tracks its own release history and is
independent of the Lima specification version — [Lima Core
1.0](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References
1.0](https://github.com/limaformat/lima/blob/main/docs/lima-references-1.0-spec.md)
are both frozen regardless of what this file shows.

## [Unreleased]

### Changed

- Error message prefix `LIMA:` → `Lima:` throughout (e.g. `LIMA: duplicate
  key "a" at line 3` → `Lima: duplicate key "a" at line 3`), plus internal
  code comments — naming-consistency fix, no functional change. `.code`
  (the stable, documented field for programmatic error handling) is
  unaffected; message text was never a documented stable API surface.

## [0.1.0] — 2026-08-05

Initial release.

### Added

- `parseCore(input, options?)` — Lima Core 1.0 only, no reference
  resolution.
- `parse(input, options?)` / `parseReferences(input, options?)` — Core plus
  the References 1.0 extension (`($key)` document references, `(%key)`
  external partials).
- Zero runtime dependencies.
- Verified against the shared, implementation-independent conformance
  corpus (250 cases as of this release; count pinned by a test — see
  [`docs/guide.md`](https://github.com/limaformat/lima/blob/main/docs/guide.md)
  and
  [`docs/corpus-design/`](https://github.com/limaformat/lima/tree/main/docs/corpus-design)).
