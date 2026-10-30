# lima

[![crates.io version](https://img.shields.io/crates/v/lima.svg)](https://crates.io/crates/lima)

**LIMA Is Metadata Annotation** — a small, predictable frontmatter format.
A deliberate, focused subset of YAML: the part frontmatter actually needs,
with well-defined types, no surprises, and zero runtime dependencies.

The current crate release is <!-- facts:packages.version -->0.6.0<!-- /facts -->.

```sh
cargo add lima
```

```rust
use lima::{parse, ParseOptions};

let result = parse(r#"
title: Hello World
published: 2024-03-01
draft: false
tags:
  - javascript
  - webdev
"#, ParseOptions::default()).unwrap();

// LimaValue::Mapping — "title" a String, "published" an Instant
// (2024-03-01T00:00:00Z), "draft" a Bool, "tags" an Array of Strings.
```

`parse`/`parse_core` accept the raw content **between** the
frontmatter delimiters (`---`) — stripping them is the caller's job.

The public entry points are:

- `parse(input, options)` — Lima References <!-- facts:language.references_version -->2.1<!-- /facts --> by default: `${key}` reads
  document values and `$(partial)` reads supplied partials.
- `parse_core(input, options)` — Lima Core <!-- facts:language.core_version -->1.2<!-- /facts --> only.
- `parse_references(input, options)` — deprecated References <!-- facts:language.references_version -->2.1<!-- /facts --> alias for
  `parse`.

`ParseOptions::default()` enables References in non-strict mode. Select
`ParseMode::Core` for the reference-unaware path. `CoreOptions` and
`ParseOptions` support an optional duplicate-key warning callback.

Both return `Result<LimaValue, LimaError>` — `LimaError` implements
`std::error::Error` and carries a stable `.code` field
(`LimaDiagnosticCode`) for programmatic error handling, alongside a
human-readable message.

The crate implements Lima Core <!-- facts:language.core_version -->1.2<!-- /facts --> and Lima References <!-- facts:language.references_version -->2.1<!-- /facts -->. Rust API docs:
**[docs.rs/lima](https://docs.rs/lima)**.

Why Lima exists, the case against YAML, and security rationale:
**[repository README](https://github.com/limaformat/lima#readme)**.

The [Lima Core <!-- facts:language.core_version -->1.2<!-- /facts -->](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References <!-- facts:language.references_version -->2.1<!-- /facts -->](https://github.com/limaformat/lima/blob/main/docs/lima-references-2.0-spec.md)
specifications are the normative source of truth — this crate implements
them exactly, verified against the same
[<!-- facts:corpus.default.cases -->620<!-- /facts -->-case conformance corpus](https://github.com/limaformat/lima/tree/main/corpus)
(counts pinned by `tests/corpus.rs` and the private References 1.0 unit-test
module) shared with the TypeScript implementation.

Migrating existing YAML frontmatter:
[docs/migrating-from-yaml.md](https://github.com/limaformat/lima/blob/main/docs/migrating-from-yaml.md).
Static site generator integration status:
[docs/integrations.md](https://github.com/limaformat/lima/blob/main/docs/integrations.md).

## License

ISC — see
[LICENSE](https://github.com/limaformat/lima/blob/main/rust/LICENSE) (also
included in this package as `LICENSE`).
