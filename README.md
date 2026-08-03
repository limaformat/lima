# Lima

**LIMA Is Metadata Annotation** — a tiny, deterministic frontmatter format with a complete reference specification.

The name is a recursive backronym — LIMA contains itself, just like [YAML (YAML Ain't Markup Language)](https://stackoverflow.com/questions/6968366/if-yaml-aint-markup-language-what-is-it). Consider it a nod: Lima is a deliberate, focused subset of YAML, keeping what works and leaving out what doesn't. Fittingly, *lima* is also Esperanto for "bounded" or "limiting" (from *limo*, "boundary") — Lima is a deliberately bounded, precisely defined metadata language.

Lima is the part of YAML that frontmatter actually needs, with well-defined types and no surprises. It adds two things YAML doesn't have: references to document properties and to externally provided partials. Everything else is familiar.

```
---
title: My First Post
tags:
  - javascript
  - webdev
published: 2024-03-01
draft: false
---
```

## Why not YAML / TOML / JSON?

- **YAML** — technically powerful, practically a minefield of edge cases and indentation ambiguity.
- **TOML** — solid, but verbose for simple frontmatter.
- **JSON** — not for humans who don't write code for a living.

Lima is what you'd write if you just wanted key-value pairs that work, with a spec small enough to read in one sitting — no 92-page grammar, no implementation-defined corners.

## Status

- [x] Lima Core 1.0 specification — final ([`docs/lima-core-1.0-spec.md`](docs/lima-core-1.0-spec.md))
- [x] Lima References 1.0 specification — final ([`docs/lima-references-1.0-spec.md`](docs/lima-references-1.0-spec.md))
- [ ] Conformance test corpus — in progress ([`corpus/`](corpus/), design rationale in [`docs/corpus-design/`](docs/corpus-design/))
- [ ] TypeScript/JavaScript implementation — placeholder published as [`@limaformat/lima`](js/)
- [ ] Rust implementation — placeholder published as [`lima`](rust/)

Both specifications are frozen at 1.0. Further changes will only ship as errata or a 1.0.1 revision, and only on the basis of the conformance corpus.

## Specification

The normative specifications are the single source of truth for Lima's syntax and semantics:

- [Lima Core 1.0](docs/lima-core-1.0-spec.md) — syntax, types, and error behaviour.
- [Lima References 1.0](docs/lima-references-1.0-spec.md) — property references and external partials.

Both specifications are self-contained as of 1.0 Final; no design-history documents are part of this repository.

## Conformance corpus

Lima ships an implementation-independent conformance test corpus so that every implementation — TypeScript, Rust, or otherwise — can be verified against the same normative test cases. The corpus itself lives in [`corpus/`](corpus/); its architecture, diagnostic model, and coverage matrix are documented in [`docs/corpus-design/README.md`](docs/corpus-design/README.md).

## Packages

This is a monorepo: implementations live alongside the specification and corpus they are validated against.

- [`js/`](js/) — [`@limaformat/lima`](https://www.npmjs.com/package/@limaformat/lima) on npm.
- [`rust/`](rust/) — [`lima`](https://crates.io/crates/lima) on crates.io.

Both are currently placeholder releases; see their status lists for progress.

## Contributing

This repository is under active development ahead of its first published packages. Issues and discussion are welcome; please read the specifications first, since they — not any single implementation — define correct Lima behaviour.

## License

[ISC](LICENSE)
