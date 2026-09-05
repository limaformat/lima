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

## [0.4.0] — 2026-09-08

First independent whole-repo review of Lima, then a second review of the
consolidated result. Nine rounds of Core 1.0 errata (`1.0.1`–`1.0.9`) and
a cross-implementation rework of References 2.0 error positions, all
fixing behaviour the specifications already required. The release line
advances to `go/v0.4.0` to align with the TypeScript package and Rust
crate. The Lima Core 1.0 and References 2.0 specification texts gain only
non-normative clarifications (§5, §5.2, §6.1.3, error-api); no rule
changed.

The shared conformance corpus grows to 211 Core and 136 References 2.0
cases (from 149 / 119). The frozen 1.0.0 baseline of 149 Core cases is
byte-identical; every added case carries a `since` revision marker.

### Changed

- An unquoted key must now match the Core §5.1 grammar
  (`[A-Za-z0-9_][A-Za-z0-9_:-]*`) in every mapping context — top level,
  nested, and flow. Keys such as `a.b`, `($x)`, `${x}`, or a key with a
  leading non-ASCII space are no longer recognised; the line or item is
  skipped in both modes. (errata 1.0.5)
- `ParseCore` computes a value's source column only on the positioned path,
  and `sourceLines` skips its pre-tab-expansion split when the document
  contains no tab, restoring the Core hot path.

### Fixed

- A bare key with a nested block is now supported as the first entry or a
  continuation key of a block-sequence item (`- key:` followed by an
  indented mapping); previously it parsed as the literal scalar `"key:"` or
  was silently dropped. (errata 1.0.4)
- `|` literal block scalars: recognised under a nested key, not only at the
  top level; the scalar ends at the first line indented to the key's column
  or less; indentation trimming removes exactly the smallest common indent.
  (errata 1.0.1)
- Quoted-string lexing is escape-aware in every value position: `"a\""` and
  `'a\''` are unterminated in flow and block contexts; `"a: b": v` parses
  as a single key; an unquoted key with interior whitespace makes its line
  or item unrecognised in nested and flow mappings. (errata 1.0.2)
- A comment line between a bare key and its nested block no longer drops
  the block; a bare blank line in the same position no longer breaks a
  nested mapping lookahead. (errata 1.0.3)
- A block-sequence item's first bare key now aligns following sibling keys
  at the key's own column, not the dash column. (errata 1.0.6)
- A `|` block-scalar line whose only content is a non-ASCII space (U+00A0,
  U+2028, …) is no longer treated as blank: it ends the scalar, matching
  TypeScript and Rust, and a multi-byte space is no longer sliced mid-rune
  into invalid UTF-8. (errata 1.0.9)
- U+2028 / U+2029 are ordinary quoted-key characters (Core §15.6 excludes
  only U+000A); Go already accepted them, TypeScript now does too.
  (errata 1.0.9)
- `\#` is collapsed to `#` only in unquoted values (Core §6.1.4). Inside
  `"..."` it is now an unknown escape (non-strict keeps the backslash,
  strict throws `INVALID_ESCAPE`); inside `'...'` a literal backslash.
  (errata 1.0.9)
- The whitespace between a value and a trailing `#` comment is stripped
  with the project whitespace set, not just ASCII space/tab — so a U+00A0
  or U+FEFF before a comment no longer stays attached to the value (which
  previously, for a flow collection, broke recognition of the `]`/`}`).
  (errata 1.0.9)
- References 2.0 error positions: `line` and `column` are the physical
  position in the original source text, counted in Unicode code points and
  identical across the TypeScript, Rust, and Go implementations.
  Leading-tab expansion and `\#` escapes no longer shift a later token's
  reported column — including inside a flow `[...]` / `{...}`. A
  block-sequence continuation-key value's raw anchor now uses the project
  whitespace boundary, not Go's `unicode.IsSpace`.
- References 2.0 diagnostic ordering: an unresolved-reference or structural
  error is attributed to the earliest participating source token, including
  across flow-collection elements on one line and across a second
  pure-reference copy.

### Performance

- `ParseCore` carries a ~10–20% regression from the §5.1 per-key validation
  and the physical-position token scan, accepted as the cost of spec
  conformance. Realistic frontmatter still parses several times faster than
  `go.yaml.in/yaml/v3`.

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
