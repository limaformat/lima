# Lima

[![npm version](https://img.shields.io/npm/v/%40limaformat%2Flima.svg)](https://www.npmjs.com/package/@limaformat/lima)

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

Full syntax, the References extension, resource limits, strict mode, and the complete API: **[`docs/guide.md`](docs/guide.md)**. Migrating existing YAML frontmatter: **[`docs/migrating-from-yaml.md`](docs/migrating-from-yaml.md)**. Static site generator integration status: **[`docs/integrations.md`](docs/integrations.md)**.

## Why not YAML / TOML / JSON?

- **YAML** — a large, feature-rich grammar. Frontmatter typically uses a small fraction of it, and the unused parts are exactly where implementations diverge from each other and where past CVEs have concentrated (see [Security](#security), below).
- **TOML** — solid, but its `[section]`/`key = value` syntax is noticeably more verbose than indentation for nested frontmatter, and it has no equivalent of Lima's References.
- **JSON** — no comments, every key and string must be quoted, no multi-line strings — workable for machines, awkward to hand-author and diff as frontmatter.

Lima is what you'd write if you just wanted key-value pairs that work, with a spec small enough to read in one sitting — no 92-page grammar, no implementation-defined corners.

Why does fifteen lines of frontmatter need a specification five times longer than JSON's or TOML's?

### How much smaller, actually

Numbers instead of adjectives. Word count is the most robust metric here (line count depends on wrapping conventions); Lima Core is the fair implementation/spec comparison unit, since References is an optional convenience layer on top, not part of what a minimal conforming implementation needs. Implementation size is split into code and comments, counted separately rather than mixed into one figure — comment density is a matter of authoring style, not grammar complexity, and conflating the two would let whichever project comments less look artificially smaller. Both sides are hand-authored TypeScript source (never a bundled/minified build): Lima Core is `js/src/`; the YAML column is [js-yaml 5.2.3's](https://github.com/nodeca/js-yaml/tree/5.2.3/src) actual parse path — the source files `load()` transitively imports (parser, constructor, schema, tag resolvers) — not its `dump()`/serialization code, which Lima Core has no equivalent of either, and not the bundled `dist/` most consumers actually install (whose bundler-added boilerplate and stripped comments would bias both sides of this comparison).

| | JSON (RFC 8259) | TOML | Lima Core | Lima Core + References | YAML 1.2.2 |
|---|---:|---:|---:|---:|---:|
| Specification (words) | 3,998 | 4,254 | 7,603 | 11,733 | 21,961 |
| Implementation, code (words) | — | — | 5,292 | 7,440 | 11,787 |
| Implementation, comments (words) | — | — | 2,398 | 4,472 | 2,144 |

YAML's specification is **~5.2–5.5× longer** than JSON's or TOML's, and **~2.9× longer** than Lima Core's ([official 1.2.2 source](https://github.com/yaml/yaml-spec/blob/main/spec/1.2.2/spec.md) — the current revision; 1.2.1/1.2.2 are errata over the 2009 1.2 release, not a newer major version). Lima Core's code is **~2.2× smaller** than js-yaml's parse path (5,292 vs. 11,787 words, comments excluded from both). The gap narrows to **~1.6×** once References is included — it's a real, additional feature (document-property and external-partial references YAML has no equivalent for), not padding. Comments run the other way: Lima's source is proportionally *more* documented, not less — comments make up 31% of Core's word count (2,398 of 7,690) against 15% for js-yaml (2,144 of 13,931), so the code-only comparison above isn't hiding thin documentation behind a comment-stripping trick. Lima Core's own spec is a little longer than JSON's/TOML's, honestly — it documents explicit type-coercion rules, date parsing, resource limits, and a full strict-mode error catalogue that those simpler formats don't attempt.

This isn't a case of counting favourably: separating "Core" from "References" in the implementation required checking actual imports, not just file boundaries — `countNodes`, `canonicalString`, and the partial-ingestion machinery sit in the same source file as Core's value model but are only ever imported by the References layer, so they're excluded from Core's count. Three exports (`isScalar`, `deepCopy`, `computeDepth`) turned out to be unused by anything at all, including tests — surfaced by this accounting and deleted outright rather than merely excluded from it.

Reproducible: `bun run bench:vs-yaml` (from `js/`) measures parse speed against js-yaml on realistic frontmatter — Bun-only numbers, don't assume they transfer proportionally to other JavaScript engines; `bun src/run.ts` (from `compat/`) reports where Lima and YAML actually diverge on the same input, not just how long each takes. Migrating existing YAML frontmatter to Lima: see [`docs/migrating-from-yaml.md`](docs/migrating-from-yaml.md), which uses this same divergence report as its evidence.

### What a smaller grammar buys

[Appendix A](docs/lima-core-1.0-spec.md#12-appendix-a-what-lima-core-does-not-support) lists 19 constructs Lima Core explicitly excludes. Checked individually against what each one is actually for: 7 are YAML-only constructs tied to well-documented complexity or security concerns (folded block scalars and chomping indicators, nested flow/sequence structures, anchors and aliases, tags, multi-document streams); 5 more remove specifically locale- or format-ambiguous date handling (including the two constructs that are ambiguous *by definition* without a locale: `MM/DD/YYYY` vs `DD/MM/YYYY`); the remaining 7 are Lima's own type-system and References-boundary decisions, not YAML-complexity avoidance as such. On top of that list, a few things never needed an Appendix A entry because the grammar never had them to begin with: YAML 1.1's wider implicit-boolean set, non-scalar mapping keys, merge keys (`<<`).

- **No implicit type ambiguity.** YAML 1.1's broader boolean set (`yes`/`no`/`on`/`off`/`y`/`n`, case-insensitive) is the source of the well-known ["Norway problem"](https://hitchdev.com/strictyaml/why/implicit-typing-removed/) — a country code `NO` silently becoming `false`. Lima recognises only the literal tokens `true`/`false`; `country: NO` stays the string `"NO"`.
- **No schema selection required for consistent behaviour.** YAML needs an explicit schema choice to get predictable results — js-yaml's own newer default no longer resolves timestamps at all, unlike what most existing frontmatter tooling (Jekyll, older js-yaml versions) actually produces. Lima has exactly one behaviour, always.
- **Hard resource limits are part of the normative spec**, not an implementation afterthought: document size, key length, scalar length, and nesting depth are all specified limits, checked in both parse modes.
- **A closed strict-mode error list** (Core §10.1) — strict mode validates an explicit, enumerated set of conditions, not "everything a parser feels like flagging."
- **A grammar expressible without regex backtracking.** The TypeScript implementation's tokenizer uses zero lookahead/lookbehind/backreference constructs and zero genuinely backtracking-dependent matching — verifiably RE2-representable, the same property linear-time engines like Google's RE2 and Rust's `regex` crate require. Not a claim about immunity to slow input in general, just that the grammar itself doesn't force a backtracking engine the way some regex-heavy formats do.
- **An implementation-independent conformance corpus** (250 cases, count pinned by a test so it can't silently drift — reproduce with `bun run run` from `corpus/runner/`) that any implementation — TypeScript, Rust, or otherwise — is checked against, addressing a longstanding YAML criticism: different YAML parsers routinely disagree with each other on ambiguous edge cases.

None of this makes Lima a YAML replacement — it's deliberately scoped to frontmatter, not general-purpose data serialisation, and the constructs it leaves out are exactly the ones YAML-parsing frontmatter rarely needs in the first place. The trade-off is explicit, not hidden: see [Appendix A](docs/lima-core-1.0-spec.md#12-appendix-a-what-lima-core-does-not-support) for the full, reasoned list.

### Security

Two of YAML's excluded constructs map directly onto real, disclosed vulnerabilities — not hypothetical risk, documented CVEs:

- **[CVE-2020-1747](https://nvd.nist.gov/vuln/detail/CVE-2020-1747)** (PyYAML, CVSS 9.8 critical) — arbitrary code execution via the `!!python/object/new` tag construct in untrusted YAML input. Lima has no tag system at all (Appendix A); there is no construct for this class of bug to attach to.
- **[CVE-2019-11253](https://en.wikipedia.org/wiki/Billion_laughs_attack)** (Kubernetes API server) — denial of service via anchor/alias exponential expansion (a "YAML bomb": each alias re-expands its anchor's full content, nesting a handful of levels deep produces gigabytes from a few kilobytes of input). Lima has no anchors or aliases (Appendix A). Notably, published mitigation guidance for this exact CVE class recommends "parsers with intentionally limited capabilities like StrictYAML" — the same restricted-grammar approach Lima takes, independently arrived at.

This isn't "Lima is unhackable" — it's narrower and more honest than that: these two specific, named attack classes have no construct to exploit, by construction, because the constructs were never added rather than added-then-restricted. Lima's own resource limits (document size, scalar length, node count, nesting depth — Core §9, checked in both parse modes) are separate, defence-in-depth protection against oversized or pathologically nested input generally, independent of any single construct.

Worth being precise about the threat model this actually matters for: both CVEs above involve YAML parsing *untrusted* input (a public API accepting arbitrary submissions). For frontmatter you write yourself, that's not the threat you're facing — this section is most relevant if something in your pipeline parses frontmatter from a source you don't fully control (a CMS accepting user content, a multi-tenant platform, etc.), less so for a personal blog's own files.

## Status

- [x] Lima Core 1.0 specification — final ([`docs/lima-core-1.0-spec.md`](docs/lima-core-1.0-spec.md))
- [x] Lima References 1.0 specification — final ([`docs/lima-references-1.0-spec.md`](docs/lima-references-1.0-spec.md))
- [x] Conformance test corpus — 250 cases, both specs, pinned by test ([`corpus/`](corpus/), design rationale in [`docs/corpus-design/`](docs/corpus-design/)); reproduce with `bun run run` from `corpus/runner/`
- [x] TypeScript/JavaScript implementation — published as [`@limaformat/lima`](js/)
- [x] Rust implementation — published as [`lima`](rust/)

Both specifications are frozen at 1.0. Further changes will only ship as errata or a 1.0.1 revision, and only on the basis of the conformance corpus.

## Specification

The normative specifications are the single source of truth for Lima's syntax and semantics:

- [Lima Core 1.0](docs/lima-core-1.0-spec.md) — syntax, types, and error behaviour.
- [Lima References 1.0](docs/lima-references-1.0-spec.md) — property references and external partials.

Both specifications are self-contained as of 1.0 Final; no design-history documents are part of this repository. [`docs/guide.md`](docs/guide.md) is a non-normative walkthrough of both — where it disagrees with a spec, the spec wins.

## Conformance corpus

Lima ships an implementation-independent conformance test corpus so that every implementation — TypeScript, Rust, or otherwise — can be verified against the same normative test cases. The corpus itself lives in [`corpus/`](corpus/); its architecture, diagnostic model, and coverage matrix are documented in [`docs/corpus-design/README.md`](docs/corpus-design/README.md).

## Packages

This is a monorepo: implementations live alongside the specification and corpus they are validated against.

- [`js/`](js/) — [`@limaformat/lima`](https://www.npmjs.com/package/@limaformat/lima) on npm.
- [`rust/`](rust/) — [`lima`](https://crates.io/crates/lima) on crates.io.

## Contributing

Issues and discussion are welcome; please read the specifications first, since they — not any single implementation — define correct Lima behaviour.

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
