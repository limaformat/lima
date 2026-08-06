# Lima Guide

A practical walkthrough of Lima syntax, the References Extension, resource
limits, and the JavaScript/TypeScript API. This guide is descriptive, not
normative — [Lima Core 1.0](lima-core-1.0-spec.md) and
[Lima References 1.0](lima-references-1.0-spec.md) are the source of truth.
Where this guide and a spec disagree, the spec wins.

## Installation

```bash
npm install @limaformat/lima
# or
bun add @limaformat/lima
```

## Quick example

```ts
import { parse } from '@limaformat/lima'

const result = parse(`
title: Hello World
published: 2024-03-01
draft: false
tags:
  - javascript
  - webdev
`)

// {
//   title: 'Hello World',
//   published: 2024-03-01T00:00:00.000Z,  // a Date
//   draft: false,
//   tags: ['javascript', 'webdev']
// }
```

`parse` accepts the raw Lima content **between** the frontmatter delimiters
(`---`) — stripping those delimiters is the caller's job, Lima never sees
them.

## Syntax

### Key names

```
[a-zA-Z0-9_][a-zA-Z0-9_:\-]*
```

An unquoted key starts with a letter, digit, or underscore, followed by any
combination of letters, digits, underscores, hyphens, or colons.

| Format | Example | Valid unquoted |
|---|---|---|
| camelCase | `firstName` | yes |
| snake_case | `first_name` | yes |
| kebab-case | `first-name` | yes |
| digit start | `1st`, `42` | yes |
| colon-namespaced | `og:title` | yes |
| spaces, other characters | `first name` | needs quoting |

Since unquoted keys may themselves contain colons, the key/value separator
is the *first* `: ` (colon + exactly one space) or `:\n` that isn't inside a
quoted key:

```yaml
og:title: Hello      # key = 'og:title', value = 'Hello'
a:b:c: value          # key = 'a:b:c', value = 'value'
```

**Quoted keys** — single or double quotes, for keys with spaces or other
characters an unquoted key can't hold. Delimiters are stripped from the
output key:

```yaml
'first name': Alice          # → { 'first name': 'Alice' }
"display name": Bob          # → { 'display name': 'Bob' }
'': empty string key         # → { '': 'empty string key' }
```

Double-quoted keys decode the same backslash escapes as double-quoted
string values (below). Single-quoted keys are literal. The separator must
immediately follow the closing quote — `"key" : value` (space before the
colon) is rejected at the top level (throws in strict mode, skipped as an
unrecognised line in non-strict). Enforcement is less consistent for a
quoted key nested inside a block or flow mapping — don't rely on a space
there being caught either way; simply avoid it.

### Strings

Unquoted:

```yaml
title: My Article
```

**Double-quoted** — suppresses type coercion, decodes escapes:

```yaml
title: "Lima: A Primer"   # → 'Lima: A Primer' (colon is safe inside quotes)
count: "42"                # → '42' (string, not number)
flag:  "true"               # → 'true' (string, not boolean)
```

| Escape | Result |
|---|---|
| `\\` | backslash |
| `\"` | double quote |
| `\/` | forward slash |
| `\n` `\r` `\t` | newline / CR / tab |
| `\b` `\f` | backspace / form feed |
| `\uXXXX` | Unicode BMP code point (4 hex digits) |
| `\UXXXXXXXX` | Unicode supplementary code point (8 hex digits) |
| `\xXX` | Latin-1 code point (2 hex digits) |

An unrecognised escape (including `\0` — there is no null-byte escape) is
left intact in non-strict mode and throws in strict mode.

**Single-quoted** — also suppresses coercion, but has exactly one special
sequence: `\'` for a literal quote. Everything else, including backslashes,
is literal — `'a\\b'` is the four characters `a\\b`, not `a\b`.

**Comments in unquoted values** — `#` starts a comment; `\#` keeps a literal
`#`. Only the immediately preceding backslash counts:

```yaml
link: https://example.com/page#section    # → 'https://example.com/page'
link: https://example.com/page\#section   # → 'https://example.com/page#section'
```

`#` inside a single- or double-quoted string is never a comment — comment
stripping only ever applies to unquoted values.

**Multi-line strings** require an explicit `|` marker — plain indented
continuation lines *without* `|` are not joined automatically:

```yaml
description: |
  Line one.
  Line two.
```

A line belongs to the block scalar as long as its indentation is strictly
greater than the introducing key's — including lines starting with `#`
(they're literal content, not comments, as long as they're still indented
further than the key).

Merge two lines into one with `^^` at the end of a line, **inside a `|`
block only** — it has no special meaning elsewhere:

```yaml
description: |
  This is a very long sentence that ^^
  continues on the next line as one.
```

There is no YAML-style `>` folded scalar — `|` + `^^` covers the same need
with less ambiguity.

### Types

| Value | Type |
|---|---|
| `null`, `~`, (empty) | null |
| `true`, `false` (case-sensitive) | Boolean |
| `42`, `3.14`, `.5` | Number |
| `0xFF`, `0o77`, `0b1010` | String (not parsed as numbers) |
| `01`, `007`, `+42`, `1.` | String (not parsed as numbers) |
| `2024-03-01`, `2024-03-01T09:00:00Z` | Date |
| `01.03.2024 14:33` | Date |
| `2024/03/01 14:33` | Date |
| anything else | String |

Leading zeros, an explicit `+` sign, a trailing bare decimal point, and
hex/octal/binary literals are all deliberately kept as strings — no silent
reinterpretation.

**Dates** are always UTC, second precision, no milliseconds:

| Form | Example |
|---|---|
| ISO date only | `2024-03-01` |
| ISO date + time | `2024-03-01T09:00`, `...T09:00:00`, `...T09:00:00Z`, `...T09:00+02:00` |
| German (`DD.MM.YYYY`, no offset) | `01.03.2024`, `01.03.2024 14:33` |
| Slash (`YYYY/MM/DD`, no offset) | `2024/03/01`, `2024/03/01 14:33` |

ISO forms require the `T` separator — a space between date and time is
*not* accepted for ISO forms. German and slash forms require a space
between date and time, and never carry a timezone offset (an offset there
falls through to a string, not an error). An ISO offset is applied and
converted to UTC:

```yaml
published: 2024-03-01T09:00:00+02:00
# → Date, 2024-03-01T07:00:00.000Z
```

Years run 0001–9999. An out-of-range calendar value (`2024-02-30`) or an
offset that pushes the resulting UTC year outside that range falls back to
a string in non-strict mode, or throws in strict mode.

### Arrays

**Block sequence** — dash-prefixed, one item per line:

```yaml
tags:
  - javascript
  - webdev
```

A bare `-` with nothing after it is `null`:

```yaml
values:
  -
  - hello
# → [null, 'hello']
```

**Flow sequence** — comma-separated in brackets, same type coercion rules,
same result as the block form:

```yaml
tags: [javascript, webdev, open-source]
values: [1, true, hello]
values: ["42", "true", hello]   # quoted items skip coercion → ['42', 'true', 'hello']
```

**Arrays of objects** — multiple keys per item, indented block style:

```yaml
authors:
  - name: Alice
    affiliation: MIT
  - name: Bob
    affiliation: Stanford
```

**Flow mapping** — inline objects, useful as array items or map values:

```yaml
menu:
  - {name: Home, url: /, weight: 1}
  - {name: About, url: /about, weight: 2}
```

Array items can be scalars or mappings, never another array or another flow
collection nested inside a flow collection — Lima intentionally doesn't
support array-of-arrays or flow nesting deeper than one level (see
[Appendix A](lima-core-1.0-spec.md#12-appendix-a-what-lima-core-does-not-support)).

### Maps

```yaml
author:
  name: Alice
  email: alice@example.com
```

Nested to any depth (up to the [nesting limit](#resource-limits)), and
inline values / nested maps can be freely mixed at the same level:

```yaml
params:
  weight: 1
  social:
    twitter: alice
  draft: false
```

### Tabs

Only tabs in **leading indentation** — before the first non-whitespace
character on a line — are normalised to two spaces. A tab that appears
within scalar content, quoted or not, is left exactly as written:

```yaml
a:
	b: 1        # → { a: { b: 1 } } — leading tab normalised to indentation
c: x	y        # → { c: 'x\ty' } — tab inside the value is preserved literally
```

### Comments

```yaml
title: My Article  # this is a comment
```

Stripped from single-line values. Multi-line (`|`) block scalars don't
process comments the same way — see [Multi-line strings](#strings) above
for the indentation-based rule that applies there instead.

## References (optional extension)

Everything in this section is the **References Extension**, layered on top
of Core. A Core-only parser (`parseCore`) treats `($key)` and `(%key)` as
plain strings — nothing below applies unless you call `parse` /
`parseReferences`.

**Document reference** — `($key)` or a dotted path `($a.b.c)`:

```yaml
total: 42
count: ($total)   # → 42 (number, not string — type preserved)
```

**Partial reference** — `(%key)`, resolved against a `partials` object you
pass in:

```yaml
author: (%defaultAuthor)
```

```ts
parse(frontmatter, {
  partials: { defaultAuthor: { name: 'Alice', email: 'alice@example.com' } }
})
```

**Pure reference vs. interpolation** — a value that is *exactly* one
reference token (after trimming) preserves the target's original type.
Anything else — surrounding text, or more than one token — is
interpolation and always produces a string:

```yaml
firstName: Alice
fullName: ($firstName) ($lastName)   # interpolation → 'Alice Wonderland'
greeting: Hello ($firstName)!        # interpolation → 'Hello Alice!'
```

A reference inside a **quoted** string is inactive — literal text, never
resolved:

```yaml
title: "($key)"   # NOT a reference — stays the literal string "($key)"
```

**Forward references work**, in both modes — Lima resolves in two passes,
so a reference to a key defined later in the document still resolves.
Unresolvable references are left as the literal token string in non-strict
mode, or throw in strict mode.

**The one-hop limit — read this before relying on chained references.**
Lima resolves at most one hop. A reference to a reference is *not*
followed transitively:

```yaml
a: ($b)
b: ($c)
c: 42
```

Result: `a` stays the literal string `'($b)'`; `b` resolves to `42`; `c` is
`42`. This is intentional, not a bug — Lima is a data format, not an
evaluation system. Design frontmatter so references point directly at
their final value, not at another reference.

Partial values are never traversed further — a reference-looking string
*inside* a partial's value is always literal, even after the partial is
inserted.

## Resource limits

Checked in both strict and non-strict mode; exceeding any of these throws
`RESOURCE_LIMIT` in both modes (there is no silent-fallback variant for
resource limits).

| Limit | Value |
|---|---:|
| Document size | 65,536 bytes (UTF-8) |
| Key length | 128 code points |
| Scalar length | 16,384 code points |
| Nesting depth | 16 |
| Top-level keys | 128 |
| Partials: count / name length / value depth / total nodes | 128 / 128 / 16 / 4,096 |
| References result: total node count | 65,536 |

## Strict mode

Most malformed values are recoverable in non-strict mode — parsing falls
back to a string, `null`, or skips the offending content, and reports what
it can via `onWarning`. A handful of conditions throw in **both** modes,
because there is no safe fallback to recover to: the [resource
limits](#resource-limits) above, flow nesting deeper than one level (Core
§10.1 itself), and — once References is layered on top — several
reference/interpolation/partial conditions (below). Check the "Non-strict"
column of each table; don't assume it always means "never throws".

| Condition | Non-strict | Strict |
|---|---|---|
| Duplicate key | warn + last value wins | throw |
| Indented freetext without `\|` | `null` | throw |
| Invalid date (calendar validation) | string fallback | throw |
| Float overflow / non-zero underflow to zero | string fallback | throw |
| Flow mapping missing `: ` | string fallback | throw |
| Flow nesting deeper than one level | throw | throw |
| Unclosed `[` or `{` | string fallback | throw |
| Trailing comma in flow sequence/mapping | ignored | throw |
| Empty flow element | `null` / skipped | throw |
| Unknown or malformed escape sequence | left intact | throw |
| Unterminated quoted string | string fallback | throw |
| Inconsistent indentation | skipped | throw |
| Space before colon in a quoted block key | skipped | throw |
| Content after a closing quote on an inline value | string fallback | throw |

References adds (Core §10.1 + References §7):

| Condition | Non-strict | Strict |
|---|---|---|
| Unresolved reference after both phases | left as token string | throw |
| Mapping value used in interpolation | throw | throw |
| Array/nested-array element in interpolation | throw | throw |
| Scalar limit exceeded after interpolation/copy | throw | throw |
| Nesting depth exceeded after reference insertion | throw | throw |
| Invalid partial value | throw | throw |

## API

```ts
import { parseCore, type CoreOptions } from '@limaformat/lima'
import { parse, parseReferences, type ParseOptions } from '@limaformat/lima'
```

`parseCore` and `parse` (an alias for `parseReferences`) both take
`(input: string, options?) => T`, `T` defaulting to
`Record<string, unknown>` — pass your own interface for a typed result.
This is a compile-time assertion only, not runtime validation: Lima does
not check that the parsed data actually matches `T`, it just tells
TypeScript to treat the return value as that type. Validate separately
(e.g. with `zod` or a manual check) if the input isn't trusted:

```ts
interface PostMeta {
  title:     string
  published: Date
  draft:     boolean
  tags:      string[]
}

const meta = parse<PostMeta>(frontmatter)
meta.title.toUpperCase()  // TypeScript knows title is a string
```

**`parseCore(input, options?: CoreOptions)`** — Core only. `($key)` /
`(%key)` are plain strings.

| Option | Type | Default |
|---|---|---|
| `strict` | `boolean` | `false` |
| `onWarning` | `(diagnostic) => void` | `undefined` |

**`parse` / `parseReferences`(input, options?: ParseOptions)`** — Core plus
the References Extension.

| Option | Type | Default |
|---|---|---|
| `strict` | `boolean` | `false` |
| `onWarning` | `(diagnostic) => void` | `undefined` |
| `partials` | `Record<string, unknown>` | `{}` |

**Duplicate keys never go to `console.warn`** — or any other implicit
output channel. Diagnostics are only ever delivered through `onWarning`;
without one, they're silently discarded:

```ts
parse(frontmatter, {
  onWarning: (d) => console.warn(d.message, 'at line', d.line),
})
```

**Strict mode** throws a plain `Error` with a descriptive `.message` on the
conditions listed [above](#strict-mode) — this is the guaranteed contract
(Core §11.3):

```ts
try {
  const meta = parse(frontmatter, { strict: true })
} catch (e) {
  console.error((e as Error).message)
}
```

Internally the thrown object also carries a `.code`, `.line`, and other
structured fields, but that richer shape isn't currently exported as a
named type from the package — don't rely on `instanceof` against a class
you can't import, or on the extra fields being present in a future
version, until that's a documented, stable export.

## Implementation notes

- **Zero runtime dependencies.**
- **No regex backtracking.** Every pattern in the implementation avoids
  lookahead, lookbehind, backreferences, and nested-quantifier
  constructions — the grammar doesn't require a backtracking engine, the
  same property linear-time engines like RE2 require. Not a claim of
  immunity to slow input in general, just that the grammar itself doesn't
  force worst-case regex behaviour.
- **Speed.** Measured against `js-yaml` on Bun, on representative
  frontmatter documents: reproduce it yourself with `bun run bench:vs-yaml`
  from `js/`. Numbers are runtime-specific — don't assume they transfer
  proportionally to other JavaScript engines.
- **Conformance corpus.** Every claim about parsing behaviour in this guide
  is backed by cases in [`corpus/`](../corpus/), checked against both this
  implementation and (where applicable) any future one — see
  [`docs/corpus-design/README.md`](corpus-design/README.md).

## Where to go next

- [Lima Core 1.0](lima-core-1.0-spec.md) and
  [Lima References 1.0](lima-references-1.0-spec.md) — the normative specs;
  this guide simplifies, they decide.
- [Repository README](../README.md) — why Lima exists, the case against
  YAML, security rationale.
