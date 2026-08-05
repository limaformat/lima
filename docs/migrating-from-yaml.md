# Migrating from YAML frontmatter

Lima is a deliberate subset of YAML block syntax — most existing YAML
frontmatter parses under Lima unchanged. This guide is about the part that
doesn't: what to check, what has no equivalent, and how to verify a
migration mechanically instead of by eye. For full syntax, see
[`docs/guide.md`](guide.md); for the underlying rules, the two normative
specs (linked throughout) are authoritative.

## The evidence this guide is based on

Two independent, reproducible sources back every claim below — neither is
a synthetic benchmark, both are checked into this repository:

- **[`compat/`](../compat/)** — runs Lima's `parseCore` and js-yaml's
  `load` on the same input and reports where they agree and disagree.
  Run it yourself: `bun install && bun run run` (from `compat/`), or
  `bun run run -- --json` for machine-readable output.
- **[`fixtures/frontmatter-samples/`](../fixtures/frontmatter-samples/)**
  — 16 hand-authored samples covering common real-world SSG/CMS
  conventions (Jekyll, Hugo, Astro, Next.js/MDX, Docusaurus, Eleventy,
  Gatsby, generic docs sites).

As of this repository's current state, **14 of those 16 samples parse
identically under Lima and js-yaml; 2 diverge**, for the specific,
understood reasons in [Block scalars and trailing
newlines](#block-scalars-and-trailing-newlines) and [Quotes and
escapes](#quotes-and-escapes) below. That is a statement about these 16
samples, not a general compatibility percentage — 16 hand-picked documents
are breadth across common shapes, not statistical coverage of arbitrary
YAML. Run `bun run run` from `compat/` against your own frontmatter for a
real answer about your own documents.

## Mostly unchanged

These constructs carry over from YAML to Lima with no rewriting needed:

- Plain scalars, `key: value` mappings, nested mappings.
- Block sequences (`- item`) and sequences of mapping objects.
- Flow sequences (`[a, b, c]`) and one level of flow mapping (`{a: 1}`).
- Comments (`#`), including `#` inside quoted strings staying literal.
- Double-quoted strings and their standard escapes (`\n`, `\t`, `\\`, `\"`,
  `\uXXXX`, …).
- `null`/`~`/empty → `null`, `true`/`false` → boolean, plain integers and
  decimals → number.
- ISO 8601 dates (`2024-03-01`, `2024-03-01T09:00:00Z`).

## Needs checking

These parse under both, but can produce a **different value**, not an
error — the risky category, because nothing will visibly fail:

- **Timestamps without a `T` separator or in a non-ISO shape.** Lima
  additionally recognises German (`DD.MM.YYYY`) and slash (`YYYY/MM/DD`)
  forms, but a YAML timestamp with a space between date and time and an
  offset (`2024-03-01 09:00 +02:00`) matches none of Lima's three forms
  and becomes a **string**, not a Date. See [Types and
  dates](#types-and-dates).
- **Hex and octal numeric literals** (`0xFF`, `0o77`) — resolved as numbers
  by js-yaml's own *default* schema (`0xFF` → `255`, `0o77` → `63`,
  verified directly against `js-yaml`'s `CORE_SCHEMA`, not just its more
  permissive `YAML11_SCHEMA`). Lima always keeps these as strings. Binary
  literals (`0b1010`) are the one form that already agrees — js-yaml's
  default schema doesn't resolve those either, both keep it as the string
  `"0b1010"`.
- **YAML's wider implicit-boolean set** (`yes`/`no`/`on`/`off`/`y`/`n`) —
  not recognised by Lima at all; these stay strings. Whether this bites
  depends on the YAML parser and schema in use: js-yaml's own *default*
  schema (`CORE_SCHEMA`) already treats `yes`/`no` as plain strings, same
  as Lima; only its more permissive `YAML11_SCHEMA` (what `compat/`
  deliberately tests against, to match older/other real-world tooling —
  see [Needs checking](#needs-checking) below) resolves them as booleans.
  Check which schema your *current* YAML tooling actually uses before
  assuming this affects you. Where it does apply, it's the ["Norway
  problem"](https://hitchdev.com/strictyaml/why/implicit-typing-removed/)
  fix, not a bug — but still a silent type change for anyone relying on
  the wider set.
- **`js-yaml`'s own schema choice matters for comparison.** Different
  `js-yaml` schemas resolve timestamps differently; `compat/` deliberately
  uses `YAML11_SCHEMA` to match what most real frontmatter tooling
  (Jekyll/Psych, older js-yaml, gray-matter) actually produces — see the
  comment at the `load()` call in `compat/src/run.ts` if a document
  behaves differently against a stricter schema.

## Not supported

These throw or silently fall through — check [Appendix
A](lima-core-1.0-spec.md#12-appendix-a-what-lima-core-does-not-support) for
the complete, reasoned list. The ones most likely to actually appear in
real frontmatter:

- `>` folded block scalar — use `|` with `^^` line-continuation instead.
- Chomping indicators `|-` / `|+`.
- Nested flow structures (`[[1, 2]]`, `{a: {b: 1}}` as a value) and
  nested block sequences (array-in-array).
- YAML anchors/aliases (`&anchor`, `*alias`) and tags (`!!str`, `!!int`).
- Multi-document streams (`---` / `...` separators within one file).
- Merge keys (`<<`).
- Non-scalar mapping keys.
- American/British date formats (`MM/DD/YYYY`, `DD/MM/YYYY`) — ambiguous
  without a locale, rejected outright rather than guessed at.

## Types and dates

Full type table in [`docs/guide.md`](guide.md#types). The date differences
specifically:

All js-yaml results below use `YAML11_SCHEMA`, the schema `compat/`
deliberately compares against (see [Needs
checking](#needs-checking)) — js-yaml's actual *default* schema
(`CORE_SCHEMA`) doesn't resolve timestamps at all, so every YAML row here
would otherwise misleadingly read "String".

| YAML input | js-yaml (`YAML11_SCHEMA`) | Lima |
|---|---|---|
| `2024-03-01T09:00:00Z` | Date | Date (unchanged) |
| `2024-03-01 09:00:00` (space, no offset) | Date — YAML 1.1 accepts a space here | **String** — ISO forms require `T` |
| `2024-03-01 09:00 +02:00` (space, with offset) | String — combining a space *and* an offset isn't resolved either | String (same result, different reason) |
| `01.03.2024` (German form) | **String** — not a YAML timestamp shape at all | **Date** — the type changes the *other* direction here |
| `2024/3/1` (single-digit month/day) | String | **String** — Lima's slash form requires two-digit month and day |

## Quotes and escapes

**The one confirmed divergence found by `compat/`'s own sample set:**
YAML's single-quote escape doubles the quote (`'It''s fine'` → `It's
fine`). Lima's single-quote escape is a backslash, matching its
double-quote convention (`'It\'s fine'` → `It's fine`) — the doubling
convention has no Lima equivalent and is **not an error**, so it fails
silently:

```yaml
subtitle: 'It''s more complicated than you think'
```

Under Lima this parses successfully as the literal string
`"It''s more complicated than you think"` (quotes preserved, not
collapsed) — reproduced directly in
`fixtures/frontmatter-samples/14-special-characters-quoted.yaml`. Rewrite
as `'It\'s more complicated than you think'` (backslash) or switch to a
double-quoted string.

Double-quoted strings and their escapes are otherwise unchanged from
typical YAML usage. `\0` is a documented exception on the Lima side — see
[`docs/guide.md`](guide.md#strings).

## Block scalars and trailing newlines

**The second confirmed divergence:** YAML's plain `|` literal block scalar
defaults to "clip" chomping — the final line break is kept, additional
trailing blank lines are removed. Lima's `|` always strips *all* trailing
newlines (YAML's "strip"/`|-` behaviour), never keeps one:

```yaml
summary: |
  Line one.
  Line two.
```

YAML: `"Line one.\nLine two.\n"` (trailing newline kept). Lima:
`"Line one.\nLine two."` (no trailing newline) — reproduced directly in
`fixtures/frontmatter-samples/16-long-description-block-scalar.yaml`. If a
trailing newline is semantically required downstream, append it after
parsing rather than relying on the block scalar to carry it.

## References — optional, not a YAML equivalent

`($key)` document references and `(%key)` external partials are a Lima
addition with no YAML equivalent — migrating YAML frontmatter never
requires using them. They're layered on top of Core via a separate
`parse`/`parseReferences` function; plain `parseCore` never interprets
`($...)`/`(%...)` at all, so existing frontmatter that happens to contain
literal parentheses is unaffected either way. See
[`docs/guide.md`](guide.md#references-optional-extension) for the full
syntax and the one-hop resolution limit.

## Migrating step by step

There is no bundled migration tool in this repository yet — the concept
below is a proposal, not something implemented here (see
[CLI concept](#a-proposed-cli-not-implemented) for why).

1. **Audit before touching anything.** Run `bun run run` from `compat/`
   against your own frontmatter (adapt `fixtures/frontmatter-samples/` or
   point the script at your own directory) to find real divergences in
   your actual documents, not hypothetical ones.
2. **Fix flagged documents first**, using the sections above — most fixes
   are narrow (a date format, a quote style) and mechanical.
3. **Switch the parser, keep the files.** Since Lima accepts a large,
   deliberate YAML subset, most existing `.yaml`/`.md` frontmatter needs
   no rewriting at all — only the specific constructs flagged in step 1.
4. **Re-run the audit** after switching to confirm no unexpected
   divergence remains.
5. **Rollback is just reverting the parser swap** — Lima doesn't rewrite
   or mutate source files, so there's nothing migration-specific to undo
   in the frontmatter itself. Keep the old parser dependency until step 4
   is clean.

### A proposed CLI, not implemented

A natural next step would be a small, dependency-free CLI wrapping the
`compat/` comparison logic for a real project's content directory:

```
lima-migrate check   <dir>   # report-only, exit code reflects match rate
lima-migrate --write <dir>   # (future) rewrite frontmatter to Lima-safe form
```

`check` is the safe, idempotent half — read-only, same shape as `compat/`'s
existing report, just pointed at a real content tree instead of
`fixtures/`. **`--write` is deliberately not proposed for immediate
implementation.** An automatic rewriter is a much larger commitment (it
needs to preserve everything a human author cares about — comments,
formatting, key order — while only changing the specific constructs that
actually diverge) and deserves its own design, test suite, and maintainer
sign-off before it touches anyone's real content. This document proposes
the `check` half as a reasonable, low-risk addition; `--write` should stay
a documented idea until someone deliberately decides to build it.
