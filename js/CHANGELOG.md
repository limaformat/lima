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

## [0.4.0] — 2026-09-08

First independent whole-repo review of Lima, then a second review of the
consolidated result. Nine rounds of Core 1.0 errata (`1.0.1`–`1.0.9`) and
a cross-implementation rework of References 2.0 error positions, all
fixing behaviour the specifications already required. The npm package
version advances to `0.4.0` to align with the Rust crate and Go module.
The Lima Core 1.0 and References 2.0 specification texts gain only
non-normative clarifications (§5, §5.2, §6.1.3, error-api); no rule
changed.

The shared conformance corpus grows to 211 Core and 136 References 2.0
cases (from 149 / 119). The frozen 1.0.0 baseline of 149 Core cases is
byte-identical; every added case carries a `since` revision marker.

### Changed

- An unquoted key must now match the Core §5.1 grammar
  (`[A-Za-z0-9_][A-Za-z0-9_:-]*`) in **every** mapping context — top level,
  nested, and flow. Keys such as `a.b`, `($x)`, `${x}`, or a key with a
  leading non-ASCII space are no longer recognised; the line or item is
  skipped in both strict and non-strict mode. Previously some of these
  were accepted as literal keys in nested or flow mappings. (errata 1.0.5)
- `parseCore` no longer builds reference-position metadata — that work is
  now confined to the `parse` / positioned path — restoring the Core hot
  path to its pre-errata baseline.

### Fixed

- `|` literal block scalars: recognised under a nested key, not only at the
  top level; the scalar now ends at the first line indented to the key's
  column or less, so a dedented comment or freetext is no longer absorbed;
  indentation trimming removes exactly the smallest common indent (no
  `key.length + 2` cap, a one-space indent is handled). (errata 1.0.1)
- Quoted-string lexing is escape-aware in every value position: `"a\""` and
  `'a\''` are unterminated in flow and block contexts too; `"a: b": v` and
  `"say \"hi\"": v` parse as a single key; an unquoted key with interior
  whitespace makes its line or item unrecognised in nested and flow
  mappings, matching the top level. (errata 1.0.2)
- A comment line between a bare key and its nested block no longer drops
  the block. (errata 1.0.3)
- A block-sequence item's first bare key now aligns following sibling keys
  at the key's own column, not the dash column. (errata 1.0.6)
- A raw U+000A inside a quoted key is rejected (Core §15.6), the `\n`
  escape is unaffected, and — corrected in 1.0.9 — U+2028 / U+2029 are
  ordinary quoted-key characters (§15.6 excludes only U+000A), matching
  the Rust and Go implementations. (errata 1.0.8 / 1.0.9)
- A block-scalar line whose only content is a non-ASCII space (U+00A0,
  U+2028, …) is no longer treated as blank in the Go implementation; it
  ends the scalar, matching TypeScript and Rust. (errata 1.0.9)
- `\#` is collapsed to `#` only in unquoted values (Core §6.1.4). Inside
  `"..."` it is now an unknown escape — non-strict keeps the backslash,
  strict throws `INVALID_ESCAPE` — and inside `'...'` a literal backslash.
  (errata 1.0.9)
- The whitespace between a value and a trailing `#` comment is stripped
  with the full project whitespace set in all three implementations, so a
  U+00A0 or U+FEFF before a comment no longer stays attached to the value
  (Go and Rust previously used narrower sets). U+0085 is not in the set
  and remains literal content. (errata 1.0.9)
- References 2.0 error positions: `line` and `column` are the physical
  position in the original source text, counted in Unicode code points and
  identical across the TypeScript, Rust, and Go implementations.
  Leading-tab expansion and `\#` escapes no longer shift a later token's
  reported column — including inside a flow `[...]` / `{...}`.
  `LimaError.column` is now populated on reference errors.
- References 2.0 diagnostic ordering: an unresolved-reference or structural
  error is attributed to the earliest participating source token,
  including across flow-collection elements on one line and across a second
  pure-reference copy.

## [0.3.1] — 2026-08-12

### Fixed

- References 2.0 document references now resolve correctly when the source
  and target share a top-level mapping, including sibling fields and separate
  nested branches. Genuine self-references and dependency cycles remain
  unresolved.

## [0.3.0] — 2026-08-12

### Changed

- **Breaking:** References 2.0 document references now use `${key}`, while
  partial references use `$(key)`. The briefly published `$(key)` document
  syntax is therefore reinterpreted as a partial reference; `$(:key)` is
  literal text.

## [0.2.0] — 2026-08-11

### Changed

- **Breaking:** `parse(input, options?)` now implements Lima References 2.0.
  Document references use `$(key)` instead of `($key)`, and partial
  references use `$(:key)` instead of `(%key)`. References 1.0 tokens are
  literal text through the public 2.0 API.
- `parseReferences(input, options?)` is now a deprecated compatibility alias
  for `parse` with identical References 2.0 results and diagnostics. It is not
  a References 1.0 mode.
- `ParseOptions.mode` selects `"references"` (the default) or `"core"`.
  Core mode uses the same reference-unaware path as `parseCore`; supplying
  `partials` in Core mode is invalid. `parseCore` itself is unchanged.
- References 2.0 adds bounded transitive resolution (at most three reference
  edges), partial mapping traversal, and `$(:namespace/name.path)` partials.
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
