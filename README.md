# Lima

**Website & documentation: [limaformat.dev](https://limaformat.dev)**

[![npm version](https://img.shields.io/npm/v/%40limaformat%2Flima.svg)](https://www.npmjs.com/package/@limaformat/lima)
[![crates.io version](https://img.shields.io/crates/v/lima.svg)](https://crates.io/crates/lima)

**LIMA Is Metadata Annotation** — a YAML-familiar, deliberately bounded frontmatter format with a complete reference specification.

The name is a recursive backronym — LIMA contains itself, just like [YAML (YAML Ain't Markup Language)](https://stackoverflow.com/questions/6968366/if-yaml-aint-markup-language-what-is-it). Consider it a nod: Lima is a deliberate, focused subset of YAML, keeping what works and leaving out what doesn't. Fittingly, *lima* is also Esperanto for "bounded" or "limiting" (from *limo*, "boundary") — Lima is a deliberately bounded, precisely defined metadata language.

*(**Lima** in running text, always — `LIMA` only when spelling out the backronym, as above. Full naming convention: [Contributing](#contributing).)*

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

## Quickstart

```bash
npm install @limaformat/lima
# or
bun add @limaformat/lima
```

**Parsing content between the fences** — `parse` takes the raw Lima content, not the surrounding `---` delimiters or the Markdown body:

```ts
import { parse } from '@limaformat/lima'

const meta = parse(`
title: My First Post
tags:
  - javascript
  - webdev
published: 2024-03-01
draft: false
`)
// { title: 'My First Post', tags: ['javascript', 'webdev'],
//   published: 2024-03-01T00:00:00.000Z, draft: false }
```

**Parsing a whole Markdown file** — splitting the fences off is the caller's job; Lima has no file-reading or fence-splitting API of its own. This is a plain, dependency-free recipe, not a bundled function — copy it, or use a library like [`front-matter`](https://www.npmjs.com/package/front-matter)/[`gray-matter`](https://www.npmjs.com/package/gray-matter) for the splitting step and hand the extracted text to Lima's `parse`:

```ts
import { readFileSync } from 'node:fs'
import { parse } from '@limaformat/lima'

function splitFrontmatter(fileContent: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(fileContent)
  if (!match) return null
  return { frontmatter: match[1], body: match[2] }
}

const file = readFileSync('post.md', 'utf-8')
const split = splitFrontmatter(file)
if (!split) throw new Error('post.md has no --- frontmatter block')

const meta = parse(split.frontmatter)
// split.body is the Markdown content after the closing fence
```

This recipe requires the opening `---` on the file's literal first line and a `---`-only closing line; it does not recognise a completely empty frontmatter block with zero blank lines between the fences (`---\n---\n`, as opposed to `---\n\n---\n`, which works). If this pattern turns out to be widely needed, an official `extractFrontmatter` (or similar) export is a reasonable future addition — proposed here, not implemented, since it's a new public API surface that deserves its own review rather than arriving as a side effect of a docs pass.

Full Core and References 2.0 syntax, resource limits, strict mode, and the complete API: **[`docs/guide.md`](docs/guide.md)**. Migrating existing YAML frontmatter: **[`docs/migrating-from-yaml.md`](docs/migrating-from-yaml.md)**.

## Why not YAML / TOML / JSON?

- **YAML** — a large, feature-rich grammar. Frontmatter typically uses a small fraction of it, and the unused parts are exactly where implementations diverge from each other and where past CVEs have concentrated (see [Security](#security), below).
- **TOML** — solid, but its `[section]`/`key = value` syntax is noticeably more verbose than indentation for nested frontmatter, and it has no equivalent of Lima's References.
- **JSON** — no comments, every key and string must be quoted, no multi-line strings — workable for machines, awkward to hand-author and diff as frontmatter.

Lima is what you'd write if you just wanted key-value pairs that work, with a spec small enough to read in one sitting — no 92-page grammar, no implementation-defined corners.

Why does fifteen lines of frontmatter need a specification five times longer than JSON's or TOML's?

### How much smaller, actually

Numbers instead of adjectives. Word count is the most robust metric here (line count depends on wrapping conventions); Lima Core is the fair implementation/spec comparison unit, since References is an optional convenience layer with no direct YAML equivalent. The three tables keep unlike measurements separate instead of filling cells with arbitrary JSON or TOML libraries. Implementation size is split into code and comments, counted separately rather than mixed into one figure — comment density is a matter of authoring style, not grammar complexity, and conflating the two would let whichever project comments less look artificially smaller.

**Specification length:**

| JSON (RFC 8259) | TOML | Lima Core 1.0 | YAML 1.2.2 |
|---:|---:|---:|---:|
| 3,998 words | 4,254 words | 7,784 words | 21,961 words |

**TypeScript implementation:**

| | Lima Core 1.0 | js-yaml 5.2.3 `load()` path |
|---|---:|---:|
| Code | 7,471 words | 11,787 words |
| Comments | 4,136 words | 2,144 words |

**Published npm package:**

| | `@limaformat/lima` 0.5.0 | `js-yaml` 5.2.3 |
|---|---:|---:|
| Packed tarball | 53.4 KB | 338 KB |

Both figures count the committed TypeScript source — not the bundled, minified, or generated `dist/` output that ships — measured from code transitively reachable from the relevant public entry point rather than by whole-file boundaries. The js-yaml measurement covers its actual `load()` parse path (parser, constructor, schema, and tag resolvers), not serialization. Package size is necessarily measured for the complete published packages: Core and References always ship together in `@limaformat/lima`, so the Lima package figure is a conservative comparison against the Core-only implementation measurement.

The Lima Core 1.0 spec is **~2.8× shorter** than YAML 1.2.2 (7,784 words vs. 21,961) and about twice JSON's or TOML's — it still documents type coercion, date parsing, resource limits, and a full strict-mode error catalogue that the simpler formats skip, and it still reads in one sitting.

js-yaml's `load()` path is ~11,800 words of TypeScript because it also contains support for anchors and aliases, merge keys (`<<`), multi-document streams, `%YAML`/`%TAG` directives, and 21 tag implementations across its four exposed schemas. Ordinary frontmatter does not require those features; tags and anchors/aliases are also the constructs implicated in the two concrete CVEs discussed below. Lima Core is about **7,500 words of code** for the subset that's actually left, plus about **4,100 words of comments** — comments are roughly 36% of the counted committed source, and many tie an implementation detail directly to a spec section. Being smaller is the easy part to measure; the part that matters is that the machinery that isn't there can't misbehave.

The complete `@limaformat/lima` 0.5.0 tarball — Core *and* References 2.0 — is **~6.3× smaller** than js-yaml 5.2.3 (53.4 KB vs. 338 KB); part of that is scope, part is that js-yaml also ships pre-built browser bundles.

This isn't a case of counting favourably: separating "Core" from "References" in the implementation requires following actual imports, not just file boundaries. Shared files are divided by what each public entry point actually reaches — for instance, three References 2.0 §2.4 source-position helpers (`stripCommentKeepEscapes`, `physicalRaw`, `rawOffsetOf`) that `parseCore` never executes count as References even though they live in shared parser files. The internally isolated, briefly-published References 1.0 code is excluded except for helpers actually imported by References 2.0. Generated `dist/`, tests, benchmarks, and dead code are excluded from both sides.

Reproduce the implementation counts from `js/` with `bun run wordcount -- --manifest scripts/wordcount.manifest.json --bucket lima-core-1.0` and `bun run wordcount -- --manifest scripts/wordcount.manifest.json --bucket lima-references-2.0-additions`. `bun run bench:vs-yaml` measures parse speed against js-yaml on realistic frontmatter — Bun-only numbers, don't assume they transfer proportionally to other JavaScript engines; `bun src/run.ts` (from `compat/`) reports where Lima and YAML actually diverge on the same input, not just how long each takes. Migrating existing YAML frontmatter to Lima: see [`docs/migrating-from-yaml.md`](docs/migrating-from-yaml.md), which uses this same divergence report as its evidence.

### What a smaller grammar buys

[Appendix A](docs/lima-core-1.0-spec.md#12-appendix-a-what-lima-core-does-not-support) lists 19 constructs Lima Core explicitly excludes. Checked individually against what each one is actually for: 7 are YAML-only constructs tied to well-documented complexity or security concerns (folded block scalars and chomping indicators, nested flow/sequence structures, anchors and aliases, tags, multi-document streams); 5 more remove specifically locale- or format-ambiguous date handling (including the two constructs that are ambiguous *by definition* without a locale: `MM/DD/YYYY` vs `DD/MM/YYYY`); the remaining 7 are Lima's own type-system and References-boundary decisions, not YAML-complexity avoidance as such. On top of that list, a few things never needed an Appendix A entry because the grammar never had them to begin with: YAML 1.1's wider implicit-boolean set, non-scalar mapping keys, merge keys (`<<`).

- **No implicit type ambiguity.** YAML 1.1's broader boolean set (`yes`/`no`/`on`/`off`/`y`/`n`, case-insensitive) is the source of the well-known ["Norway problem"](https://hitchdev.com/strictyaml/why/implicit-typing-removed/) — a country code `NO` silently becoming `false`. Lima recognises only the literal tokens `true`/`false`; `country: NO` stays the string `"NO"`.
- **No schema selection required for consistent behaviour.** YAML needs an explicit schema choice to get predictable results — js-yaml's own newer default no longer resolves timestamps at all, unlike what most existing frontmatter tooling (Jekyll, older js-yaml versions) actually produces. Lima has exactly one behaviour, always.
- **Hard resource limits are part of the normative spec**, not an implementation afterthought: document size, key length, scalar length, and nesting depth are all specified limits, checked in both parse modes.
- **A closed strict-mode error list** (Core §10.1) — strict mode validates an explicit, enumerated set of conditions, not "everything a parser feels like flagging."
- **A grammar expressible without regex backtracking.** The TypeScript implementation's tokenizer uses zero lookahead/lookbehind/backreference constructs and zero genuinely backtracking-dependent matching — verifiably RE2-representable, the same property linear-time engines like Google's RE2 and Rust's `regex` crate require. Not a claim about immunity to slow input in general, just that the grammar itself doesn't force a backtracking engine the way some regex-heavy formats do.
- **An implementation-independent conformance corpus** with 211 Core 1.0 cases (a byte-frozen 149-case 1.0.0 baseline plus additive errata through 1.0.9) and 136 References 2.0 cases, all count-pinned and passed by TypeScript, Rust, and Go. Reproduce the independently runnable targets from `corpus/runner/`.

None of this makes Lima a YAML replacement — it's deliberately scoped to frontmatter, not general-purpose data serialisation, and the constructs it leaves out are exactly the ones YAML-parsing frontmatter rarely needs in the first place. The trade-off is explicit, not hidden: see [Appendix A](docs/lima-core-1.0-spec.md#12-appendix-a-what-lima-core-does-not-support) for the full, reasoned list.

### Security

Two of YAML's excluded constructs map directly onto real, disclosed vulnerabilities — not hypothetical risk, documented CVEs:

- **[CVE-2020-1747](https://nvd.nist.gov/vuln/detail/CVE-2020-1747)** (PyYAML, CVSS 9.8 critical) — arbitrary code execution via the `!!python/object/new` tag construct in untrusted YAML input. Lima has no tag system at all (Appendix A); there is no construct for this class of bug to attach to.
- **[CVE-2019-11253](https://nvd.nist.gov/vuln/detail/CVE-2019-11253)** (Kubernetes API server) — denial of service via anchor/alias exponential expansion (a "YAML bomb": each alias re-expands its anchor's full content, nesting a handful of levels deep produces gigabytes from a few kilobytes of input). Lima has no anchors or aliases (Appendix A). Notably, published mitigation guidance for this exact CVE class recommends "parsers with intentionally limited capabilities like StrictYAML" — the same restricted-grammar approach Lima takes, independently arrived at.

This isn't "Lima is unhackable" — it's narrower and more honest than that: these two specific, named attack classes have no construct to exploit, by construction, because the constructs were never added rather than added-then-restricted. Lima's own resource limits (document size, scalar length, node count, nesting depth — Core §9, checked in both parse modes) are separate, defence-in-depth protection against oversized or pathologically nested input generally, independent of any single construct.

Worth being precise about the threat model this actually matters for: both CVEs above involve YAML parsing *untrusted* input (a public API accepting arbitrary submissions). For frontmatter you write yourself, that's not the threat you're facing — this section is most relevant if something in your pipeline parses frontmatter from a source you don't fully control (a CMS accepting user content, a multi-tenant platform, etc.), less so for a personal blog's own files.

## Status

- [x] Lima Core 1.0 specification — final ([`docs/lima-core-1.0-spec.md`](docs/lima-core-1.0-spec.md))
- [x] Frozen Core 1.0 conformance baseline — a byte-identical 149-case 1.0.0 baseline, count-pinned and content-hash protected, with additive Core errata through 1.0.9 on top ([`corpus/`](corpus/), design rationale in [`docs/corpus-design/`](docs/corpus-design/))
- [x] Lima References 2.0 specification — final with a 136-case corpus; TypeScript, Rust, and Go pass the complete suite through their public References 2.0 APIs ([spec](docs/lima-references-2.0-spec.md), [coverage](docs/corpus-design/coverage/references-2.0.md))
- [x] TypeScript/JavaScript implementation — published as [`@limaformat/lima`](js/)
- [x] Rust implementation — published as [`lima`](rust/)
- [x] Go implementation — published as [`github.com/limaformat/lima/go`](go/)

The Core 1.0 specification is frozen. Corrections ship only as additive errata
revisions (Core is currently at 1.0.9), driven by the conformance corpus rather
than any single implementation, and never altering the byte-frozen 1.0.0
baseline.

The runnable reference API in every implementation is **Core 1.0 plus
References 2.0**.

An earlier **References 1.0** was published briefly in mid-2026 and superseded
almost immediately by References 2.0, which is deliberately not
syntax-compatible with it. Its [frozen specification](docs/lima-references-1.0-spec.md)
and 101-case corpus stay in the repository — the corpus still runs, protected by
the same content-hash manifests, as a regression guard on internal code — but
References 1.0 is not a target current implementations are asked to hit and its
`($key)` / `(%key)` syntax is not a public parsing entry point anywhere.

## Specification

The normative specifications are the single source of truth for Lima's syntax and semantics:

- [Lima Core 1.0](docs/lima-core-1.0-spec.md) — syntax, types, and error behaviour.
- [Lima References 2.0](docs/lima-references-2.0-spec.md) — versioned syntax, partial mapping paths, and bounded transitive references.

The specifications are self-contained; no design-history documents are part of this repository. [`docs/guide.md`](docs/guide.md) is a non-normative walkthrough of Core 1.0 and References 2.0 — where it disagrees with a spec, the spec wins. The superseded [References 1.0 specification](docs/lima-references-1.0-spec.md) stays archived in the repository (see Status above).

## Conformance corpus

Lima ships an implementation-independent conformance test corpus so that every implementation can be verified against the same normative cases. TypeScript, Rust, and Go each pass all 211 Core 1.0 and 136 References 2.0 cases, plus a frozen 101-case References 1.0 regression corpus (see Status). The corpus itself lives in [`corpus/`](corpus/); its architecture, diagnostic model, and coverage matrix are documented in [`docs/corpus-design/README.md`](docs/corpus-design/README.md).

## Packages

This is a monorepo: implementations live alongside the specification and corpus they are validated against.

- [`js/`](js/) — [`@limaformat/lima`](https://www.npmjs.com/package/@limaformat/lima) on npm.
- [`rust/`](rust/) — [`lima`](https://crates.io/crates/lima) on crates.io.
- [`go/`](go/) — [`github.com/limaformat/lima/go`](https://pkg.go.dev/github.com/limaformat/lima/go) on pkg.go.dev.

## Contributing

Issues and discussion are welcome; please read the specifications first, since they — not any single implementation — define correct Lima behaviour.

The specifications were written by hand. The three implementations were built largely with AI coding assistants (Claude Code and Codex CLI) working against the specs and the conformance corpus, with the two agents alternating between implementing a unit of work and independently reviewing it, plus separate external review passes. The correctness claims rest on the normative specs, the language-neutral corpus, and that review — not on who typed the code.

### Naming

| Context | Spelling | Example |
|---|---|---|
| Running text, including sentence-initial position | `Lima` | "Lima is a deliberate, focused subset of YAML" |
| Logo/wordmark | `lima·format` | stays lowercase — a typographic choice, not a spelling rule |
| Spelling out the backronym | `LIMA Is Metadata Annotation` | acronym letters capitalised, that's the point |
| Technical identifiers | `lima` | npm package `@limaformat/lima`, crate `lima`, anchor IDs, `---lima` fence |

`Lima` is a proper noun like Python or Rust, not a stylized-lowercase brand (no eBay/iPhone-style forced lowercase at sentence start) — the lowercase word *lima* already means something else in this README (Esperanto for "bounded", see above), so keeping the brand capitalised is what keeps it legible as a name rather than the common word. Technical identifiers stay lowercase because npm/crates.io/URL conventions require it, not because the brand does.

## License

[ISC](LICENSE)
