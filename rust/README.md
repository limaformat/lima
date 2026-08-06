# lima

[![crates.io version](https://img.shields.io/crates/v/lima.svg)](https://crates.io/crates/lima)

**LIMA Is Metadata Annotation** — a small, predictable frontmatter format.
A deliberate, focused subset of YAML: the part frontmatter actually needs,
with well-defined types, no surprises, and zero runtime dependencies.

```toml
[dependencies]
lima = "0.1"
```

```rust
use lima::{parse_references, ReferencesOptions};

let result = parse_references(r#"
title: Hello World
published: 2024-03-01
draft: false
tags:
  - javascript
  - webdev
"#, ReferencesOptions::default()).unwrap();

// LimaValue::Mapping — "title" a String, "published" an Instant
// (2024-03-01T00:00:00Z), "draft" a Bool, "tags" an Array of Strings.
```

`parse_core`/`parse_references` accept the raw content **between** the
frontmatter delimiters (`---`) — stripping them is the caller's job.

Two entry points are exported:

- `parse_core(input, strict)` — the base format only (Lima Core 1.0).
- `parse_references(input, options)` — adds `($key)` document references
  and `(%key)` external partials (Lima References 1.0); `options.partials`
  supplies named values, `options.strict` enables strict mode.

Both return `Result<LimaValue, LimaError>` — `LimaError` implements
`std::error::Error` and carries a stable `.code` field
(`LimaDiagnosticCode`) for programmatic error handling, alongside a
human-readable message.

Full syntax reference, the References extension, resource limits, and
strict mode:
**[docs/guide.md](https://github.com/limaformat/lima/blob/main/docs/guide.md)**
(examples there are TypeScript; the syntax and semantics it describes are
implementation-agnostic). Rust API docs: **[docs.rs/lima](https://docs.rs/lima)**.

Why Lima exists, the case against YAML, and security rationale:
**[repository README](https://github.com/limaformat/lima#readme)**.

The [Lima Core 1.0](https://github.com/limaformat/lima/blob/main/docs/lima-core-1.0-spec.md)
and [Lima References 1.0](https://github.com/limaformat/lima/blob/main/docs/lima-references-1.0-spec.md)
specifications are the normative source of truth — this crate implements
them exactly, verified against the same
[250-case conformance corpus](https://github.com/limaformat/lima/tree/main/corpus)
(count pinned by `tests/corpus.rs`) shared with the TypeScript
implementation.

Migrating existing YAML frontmatter:
[docs/migrating-from-yaml.md](https://github.com/limaformat/lima/blob/main/docs/migrating-from-yaml.md).
Static site generator integration status:
[docs/integrations.md](https://github.com/limaformat/lima/blob/main/docs/integrations.md).

## License

ISC — see
[LICENSE](https://github.com/limaformat/lima/blob/main/rust/LICENSE) (also
included in this package as `LICENSE`).
