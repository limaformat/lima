# Lima Core 1.0 — Normative Specification

**Status:** Final  
**Version:** 1.0.0  
**Date:** 2026-07-31

This document is the normative specification for Lima Core 1.0. It defines the syntax, semantics, and error behaviour of the Lima frontmatter format. All conforming implementations must produce identical output for any given valid input.

Lima is not a general-purpose data format. It is a small, predictable frontmatter format — the part of YAML that frontmatter actually needs, with well-defined types and no surprises.

---

## 1. Definitions

**Document:** A UTF-8 encoded string of Lima frontmatter content, without the surrounding `---` delimiters. Stripping delimiters is the caller's responsibility.

**Key:** A named field in a Lima document.

**Value:** The data associated with a key. Values have a type determined by the parsing rules in §6.

**Scalar:** A single atomic value: string, number, boolean, date, or null.

**Block scalar:** A multi-line string introduced by a `|` marker. A block scalar is a scalar, not a block structure.

**Block structure:** A mapping or sequence written across multiple indented lines.

**Mapping:** A collection of key-value members. Member order is not semantically significant — consumers must not rely on enumeration order. A formatter may preserve source order.

**Sequence:** An ordered list of values. Also called an array.

**Flow form:** An inline mapping (`{...}`) or sequence (`[...]`) written on a single line.

**Block form:** A mapping or sequence written across multiple indented lines.

**UTC Instant:** An abstract point in time expressed in UTC with second precision and zero milliseconds. The concrete representation depends on the host language (see §6.5.3).

**Document sigil (`$`):** The character that introduces a document reference within `($...)` syntax. Meaningful only to a Lima References conforming parser; treated as literal string content by a Lima Core parser.

**Partial sigil (`%`):** The character that introduces a partial reference within `(%...)` syntax. Meaningful only to a Lima References conforming parser; treated as literal string content by a Lima Core parser.

**Strict mode:** A parse mode in which a defined set of additional checks are enforced and throw errors instead of falling back silently. See §10.

**Non-strict mode:** The default parse mode. Tolerant by design — unrecognised syntax is skipped or falls back to a safe value. See §10.

---

## 2. Conformance

A conforming Lima Core parser MUST:

- Accept all valid Lima Core syntax as defined in this document.
- Produce the output types specified in §6.
- Enforce all resource limits specified in §9.
- Implement both strict and non-strict mode as specified in §10.
- Produce identical output for identical input, regardless of implementation language.

A conforming Lima Core parser MUST NOT:

- Accept syntax not defined in this document without falling back as specified.
- Silently produce incorrect values (e.g. normalising invalid dates, misidentifying types).
- Rely on host-language-specific behaviour for parsing numbers or dates.
- Emit warnings to implicit output channels (e.g. console). All diagnostics must be delivered via the `onWarning` callback (see §11.2).

---

## 3. Input Normalisation

Before parsing, the input MUST be normalised in the following order:

1. **Line endings:** All `\r\n` sequences are replaced with `\n`. All remaining standalone `\r` characters are replaced with `\n`.
2. **Tabs in leading indentation:** Tab characters (`\t`) that appear before the first non-whitespace character on a line are replaced with two spaces (`  `). Tabs within scalar content are left unchanged.
3. **Trailing whitespace:** Trailing spaces on each line are removed.

Normalisation applies to the entire document before any other processing. These steps are unconditional and apply in both strict and non-strict mode.

---

## 4. Document Structure

A Lima document consists of zero or more top-level key-value pairs. Keys must start at column 0 (no leading indentation). Each key-value pair has the form:

```
key: value
```

or, for block values:

```
key:
  block content
```

The separator between key and value is `: ` (colon followed by a single space) for inline values, or `:\n` (colon followed by a newline) for block values. Trailing spaces after the colon are ignored.

**Inline value processing:** The inline value scanner processes the full source value while respecting quote boundaries:

1. Scan left-to-right, tracking quoted regions (single and double quotes with their respective escape rules).
2. The first unescaped `#` outside a quoted region begins a comment — it and everything following it are removed.
3. Trim leading and trailing spaces from the remaining text.
4. If the remaining text begins with a quote character, it is a quoted value **only** when the matching closing quote is the final remaining character after trimming. Any non-whitespace content after the closing quote is invalid:
   - Non-strict: string fallback (entire remaining text returned as string).
   - Strict: throw.
5. For quoted values: strip the surrounding delimiters and apply the appropriate escape processing (see §6.1.2, §6.1.3). Content inside the quotes is never trimmed or further comment-stripped.
6. For unquoted values: trim leading and trailing spaces again (a second trim, to handle trailing spaces left after comment removal). If the result is empty, produce `null`. Apply scalar type conversion.

Examples:
```yaml
title: "Hello # world" # comment   # → 'Hello # world'  (# inside quotes is literal; outer comment stripped)
title: "Hello"         # comment   # → 'Hello'           (closing quote is final; outer comment stripped)
title: "Hello" trailing            # → error/fallback    (non-whitespace after closing quote)
title:   Hello World   # comment   # → 'Hello World'     (unquoted; both trims applied)
title: 42              # comment   # → 42                (number after double trim)
```

Lines that do not match any key pattern and are not part of a block value are silently skipped in both strict and non-strict mode. Top-level unrecognised lines are not in the strict error list (see §10).

---

## 5. Key Syntax

### 5.1 Unquoted Keys

An unquoted key matches the following pattern:

```
[a-zA-Z0-9_][a-zA-Z0-9_:\-]*
```

Valid examples: `title`, `firstName`, `h1`, `_draft`, `snake_case`, `kebab-case`, `og:title`, `1st`, `42`

**Key-value separator rule:** Since unquoted keys may contain colons, the key-value separator is the first `: ` (colon followed by exactly one space) or `:\n` (colon followed by a newline) that is not inside a quoted key. Everything before it is the key; everything after is the value.

Examples:
```yaml
og:title: Hello      # key = 'og:title', value = 'Hello'
a:b:c: value         # key = 'a:b:c', value = 'value'
title:  Hello        # key = 'title', value = 'Hello' (extra space trimmed)
```

### 5.2 Quoted Keys

Keys containing spaces or other characters not permitted in unquoted keys must be quoted. Both single and double quotes are supported.

```yaml
'first name': Alice
"display name": Bob
'key: with colon': value
'': empty string key
```

- **Single-quoted keys** are literal. No escape processing.
- **Double-quoted keys** decode the same backslash escape sequences as double-quoted string values (see §6.1.2).

The key in the output object is the content between the quotes — delimiters are stripped. After the closing quote, the separator must follow immediately: `: ` or `:\n`. A space between the closing quote and the colon is not valid.

```yaml
"first name": Alice    # valid
"first name" : Alice   # invalid — space before colon
```

Non-strict: treat as unrecognised line, skip. Strict: throw.

### 5.3 Duplicate Keys

Duplicate keys are invalid at all mapping levels (top-level, nested maps, flow mappings, object arrays), with mode-dependent handling:

- **Non-strict:** Emit a warning via `onWarning`. Last value wins.
- **Strict:** Throw. Error message includes the key name and 1-based line number.

Duplicate detection and resource limit counting (§9) both occur at parse time, before duplicate resolution. Each recognised key entry increments the counter and is checked for duplication independently.

---

## 6. Value Types

Lima automatically converts scalar values to their most natural type. Conversion order: null → boolean → number → date → string (fallback).

### 6.1 Strings

#### 6.1.1 Unquoted Strings

Any value that does not match null, boolean, number, or date is a string.

Inline comments and whitespace are processed according to the complete pipeline defined in §4 (inline value processing). See §8 for comment syntax.

#### 6.1.2 Double-Quoted Strings

A value enclosed in matching double quotes (`"..."`) is a string. Type coercion is not applied. The following backslash escape sequences are decoded:

| Escape | Result |
|--------|--------|
| `\\` | backslash |
| `\"` | double quote |
| `\/` | forward slash |
| `\n` | newline (U+000A) |
| `\r` | carriage return (U+000D) |
| `\t` | tab (U+0009) |
| `\b` | backspace (U+0008) |
| `\f` | form feed (U+000C) |
| `\uXXXX` | Unicode BMP code point (4 hex digits, uppercase or lowercase) |
| `\UXXXXXXXX` | Unicode supplementary code point (8 hex digits, uppercase or lowercase) |
| `\xXX` | Latin-1 code point (2 hex digits, uppercase or lowercase) |

**Error handling for malformed escapes:**

| Condition | Non-strict | Strict |
|-----------|-----------|--------|
| Unknown escape sequence (e.g. `\q`, `\z`, `\0`) | Leave intact (backslash preserved) | throw |
| Incomplete `\uXXXX` (fewer than 4 hex digits) | Leave intact | throw |
| Incomplete `\UXXXXXXXX` (fewer than 8 hex digits) | Leave intact | throw |
| Invalid hex digits in `\u`, `\U`, `\x` | Leave intact | throw |
| `\UXXXXXXXX` outside Unicode range (> U+10FFFF) | Leave intact | throw |
| UTF-16 surrogate in `\uXXXX` (U+D800–U+DFFF) | Leave intact | throw |
| Unterminated string (no closing `"`) | String fallback (from opening quote to end of line) | throw |

Escape sequences left intact in non-strict mode are counted in their preserved literal form for scalar length purposes (§9).

Inside double-quoted strings, `#` is never a comment — comment stripping does not apply inside quoted strings.

#### 6.1.3 Single-Quoted Strings

A value enclosed in matching single quotes (`'...'`) is a string. Type coercion is not applied.

Single-quoted strings have exactly one special sequence: `\'` produces a single quote character. All other characters, including backslashes, are literal. `\\` is two characters (backslash + backslash), not one backslash.

Inside single-quoted strings, `#` is never a comment.

| Condition | Non-strict | Strict |
|-----------|-----------|--------|
| Unterminated string (no closing `'`) | String fallback (from opening quote to end of line) | throw |

#### 6.1.4 Unquoted Value Comment Escaping

In unquoted values, `\#` is an escaped hash: the backslash is removed and `#` is kept as a literal character (not a comment). Only the immediately preceding backslash is considered — earlier backslashes are not counted.

| Input | Result | Reason |
|-------|--------|--------|
| `text\#rest` | `text#rest` | `\#` → `#`, no comment |
| `text\\#rest` | `text\#rest` | second `\` escapes `#`; first `\` is literal |
| `text\\\#rest` | `text\\#rest` | third `\` escapes `#`; first two are literal (two backslashes preserved) |
| `text\\rest` | `text\\rest` | no `#` follows; both `\` are literal |
| `text#rest` | `text` | unescaped `#` starts comment |

#### 6.1.5 Multi-line Strings (Block Scalars)

Multi-line strings require an explicit `|` marker on the first line:

```yaml
description: |
  Line one.
  Line two.
```

The `|` must appear alone on its line (after the key separator).

**Block scalar extent:** A line belongs to a block scalar if and only if its indentation is strictly greater than the indentation of the key that introduced the scalar. This rule applies to all lines, including lines beginning with `#`. An indented `#` line is literal scalar content; a dedented `#` line ends the scalar and is processed as a Lima comment by the surrounding structure. Empty lines between scalar content lines belong to the scalar regardless of their indentation.

Examples:
```yaml
description: |
  Text
# top-level comment   ← dedented, ends scalar; Lima comment
title: Hello
```
→ `description = 'Text'`, `title = 'Hello'`

```yaml
description: |
  Text
  # indented comment  ← belongs to scalar, literal content
  More text
```
→ `description = 'Text\n# indented comment\nMore text'`

**Key with empty block and following comment:**
```yaml
empty:
  # comment
next: value
```
→ `empty = null`, `next = 'value'` (comment is skipped, no content lines at deeper indentation)

**Indentation trimming:** The content indentation is the smallest number of leading spaces among all non-empty content lines, measured from column 0. Empty lines do not participate in this calculation. This uniform indentation is removed from the start of every content line. Empty lines are preserved as empty strings in the joined result. Lines are joined with a single newline character (`\n`) between each consecutive pair.

**Trailing content:** All trailing empty lines and newlines at the end of a block scalar are removed (strip behaviour). The parsed value ends with the final non-empty content line and contains no trailing newline. Tabs within the final content line are preserved — only trailing empty lines and newlines are stripped, not whitespace within lines.

**Inline content without `|`:** Indented freetext without a `|` marker is not a valid multi-line string.
- Non-strict: the key's value is `null`.
- Strict: throw. Error includes 1-based line number.

#### 6.1.6 Line Continuation (`^^`)

Within a `|` block, a line beginning with `^^` (after indentation trimming) is a continuation line. It is appended to the previous line with a single space, and the `^^` marker is removed.

```yaml
description: |
  This is a very long sentence that
  ^^continues on the next line as one.
```
→ `"This is a very long sentence that continues on the next line as one."`

Rules:
- `^^` must appear at the very start of the line content (after indentation trimming).
- A `^^` line with no further content (bare `^^`) is silently dropped — no trailing space is added to the previous line.
- `^^` on the first content line of a block has no previous line to append to — the marker is stripped and the content is kept as-is.
- `^^` is only valid inside `|` blocks. It has no special meaning in plain scalars or quoted strings.
- A line that must literally begin with `^^` cannot be represented in Lima Core 1.0 — this is a documented limitation.

The folded block scalar `>` is not supported. Lines joining via `>` must be rewritten using `|` + `^^`.

### 6.2 Null

The following values produce `null`:

- Empty value (key with no value, or value reduced to empty after the complete inline value processing pipeline defined in §4)
- The literal string `null`
- The literal string `~`

### 6.3 Boolean

- `true` → boolean true
- `false` → boolean false

Case-sensitive. `True`, `TRUE`, `yes`, `no` are strings.

### 6.4 Numbers

#### 6.4.1 Grammar

The following grammar defines all recognised number forms. Implementations must apply this grammar directly, not delegate to host-language number parsing functions.

```
number       = "-"? significand exponent?
significand  = integer-part | decimal | leading
integer-part = "0" | [1-9][0-9]*
decimal      = integer-part "." [0-9]+
leading      = "." [0-9]+
exponent     = [eE] [+-]? [0-9]+
```

**Type determination:**
- A number with no decimal point and no exponent is an **integer**.
- A number with a decimal point or an exponent (or both) is a **float**.

Valid examples: `42`, `-1`, `0`, `3.14`, `-0.5`, `.5`, `-.5`, `1e3`, `1E+3`, `.5e2`, `1.5e-2`

Invalid (remain strings): `1e`, `1e+`, `.5E`, `1e-`

#### 6.4.2 Range and Overflow

**Integers:** Values outside the range −(2^53−1) to 2^53−1 (IEEE 754 safe integer range) fall back to string in both modes. This ensures identical output across implementations regardless of host-language integer representation. `BigInt` and arbitrary-precision integers are not part of the Lima type system.

**Zero normalisation:** Any numeric value whose parsed mathematical value is zero — whether integer (`-0`) or float (`-0.0`) — and which did not result from underflow, is normalised to positive zero. This ensures identical output across JavaScript (which distinguishes `+0` and `-0`) and Rust (which has no negative integer zero). Therefore `value: -0` produces the integer `0`, and `value: -0.0` produces the float `0.0`.

**Floats:** Follow IEEE 754 double precision.
- If conversion produces a non-finite value (`Infinity` or `-Infinity`) due to overflow: non-strict — string fallback; strict — throw.
- If a syntactically non-zero float converts to positive or negative zero due to underflow: non-strict — string fallback; strict — throw.
- Subnormal (denormal) values that remain non-zero are accepted as normal float values in both modes.

Lima does not produce `Infinity`, `-Infinity`, `NaN`, or negative zero as output values.

#### 6.4.3 Explicitly Not Numbers

The following forms are not matched by the grammar and remain strings:

| Form | Example |
|------|---------|
| Explicit plus sign | `+42` |
| Trailing decimal point | `1.` |
| Leading zeros (non-zero) | `01`, `007` |
| Hexadecimal | `0xFF`, `0XFF` |
| Octal | `0o77`, `0O77` |
| Binary | `0b1010`, `0B1010` |
| `Infinity` literal | `Infinity` |
| `NaN` literal | `NaN` |
| Bare exponent | `1e`, `1e+`, `1e-` |

### 6.5 Dates

#### 6.5.1 Recognised Formats

Dates are recognised when the value matches one of the following forms exactly. Component validation applies to all forms (see §6.5.2).

**ISO 8601** — offset supported:

| Form | Example |
|------|---------|
| Date only | `2024-03-01` |
| Date + time | `2024-03-01T09:00` |
| Date + time + seconds | `2024-03-01T09:00:00` |
| Date + time + seconds + Z | `2024-03-01T09:00:00Z` |
| Date + time + offset | `2024-03-01T09:00+02:00` |
| Date + time + seconds + offset | `2024-03-01T09:00:00+02:00` |

The `T` separator between date and time is required for ISO forms. A space separator is not accepted for ISO forms.

**German format** (`DD.MM.YYYY` or `D.M.YYYY`) — no offset, always UTC:

| Form | Example |
|------|---------|
| Date only | `01.03.2024` or `1.3.2024` |
| Date + time | `01.03.2024 14:33` |
| Date + time + seconds | `01.03.2024 14:33:00` |

Day and month may be one or two digits. A space separator between date and time is required.

**Slash format** (`YYYY/MM/DD`) — no offset, always UTC:

| Form | Example |
|------|---------|
| Date only | `2024/03/01` |
| Date + time | `2024/03/01 14:33` |
| Date + time + seconds | `2024/03/01 14:33:00` |

Month and day must be two digits in slash format. A space separator between date and time is required.

#### 6.5.2 Component Validation

All date and time components are validated individually. Dates use the proleptic Gregorian calendar. Years range from 0001 through 9999.

| Component | Valid range | Notes |
|-----------|------------|-------|
| Year | 0001–9999 | |
| Month | 1–12 | ISO and slash: exactly two digits in the format pattern (e.g. `03`, not `3`); German: one or two digits |
| Day | 1–last day of month | Calendar-aware including leap years; ISO and slash: exactly two digits in the format pattern; German: one or two digits |
| Hour | 00–23 | |
| Minute | 00–59 | |
| Second | 00–59 | Leap seconds not supported |
| Offset hour | 00–14 | |
| Offset minute | 00–59 | If offset hour is 14, offset minute MUST be 00 |

The reconstructed date components must match the input exactly. Invalid calendar dates (e.g. `2024-02-30`) are not silently normalised. `-00:00` is treated identically to `+00:00` (UTC). `24:00` is not accepted.

- **Non-strict:** String fallback. The value is returned as a string unchanged.
- **Strict:** Throw. Error includes the invalid value and 1-based line number.

#### 6.5.3 UTC Instant and Language Bindings

All date values represent a **UTC Instant**: a point in time in UTC with second precision and zero milliseconds.

- **ISO 8601 with offset:** Converted to UTC by applying the offset.
- **ISO 8601 without offset:** Interpreted directly as UTC.
- **ISO 8601 date-only:** Represents UTC midnight.
- **German and slash formats:** Always interpreted as UTC. Timezone offsets are not supported for these formats. Authors requiring timezone-aware values must use ISO 8601 with an explicit offset.

**UTC Instant range:** After applying the timezone offset, the resulting UTC Instant must also fall within years 0001–9999. If the UTC result falls outside this range (e.g. `0001-01-01T00:00+14:00` → year 0000 UTC, or `9999-12-31T23:59-14:00` → year 10000 UTC), the value is invalid.

- Non-strict: string fallback.
- Strict: throw. Error includes the original input value and 1-based line number.

**Language bindings:**

| Language | Concrete type |
|----------|--------------|
| JavaScript/TypeScript | `Date` (milliseconds always 0) |
| JSON serialisation | RFC 3339 string (`2024-03-01T09:00:00Z`) |
| Rust | To be defined in the Rust implementation document |

#### 6.5.4 Explicitly Not Recognised

The following date-like forms are not recognised and remain strings:

- Space-separated ISO datetime: `2024-03-01 09:00`
- Milliseconds: `2024-03-01T09:00:00.000Z`
- Year only: `2024`
- Year + month: `2024-03`
- American format `MM/DD/YYYY` — ambiguous without locale
- British format `DD/MM/YYYY` — ambiguous without locale
- Offset with German or slash format
- Strings containing `@` (guards email addresses)

---

## 7. Collections

### 7.1 Indentation Model

Lima uses indentation to determine block structure. The following rules apply:

1. Each block receives its **base indentation** from the indentation of its first non-empty, non-comment content line.
2. All direct children of a block must have exactly this base indentation.
3. A line indented deeper than the base indentation belongs to the immediately preceding key's value as a nested block.
4. A line whose indentation is less than the base indentation ends the current block and returns to the parent level.
5. A line whose indentation does not correspond to any currently open block level is inconsistently indented — silently skipped in non-strict; throw in strict.
6. Empty lines (blank or whitespace-only) do not affect base indentation and are skipped.
7. Comment lines (first non-whitespace character is `#`) do not affect base indentation and are skipped.

Minimum indentation is one space. There is no required indentation increment — two spaces is conventional but not normative.

### 7.2 Block Sequences (Arrays)

A block sequence is a list of values, each on its own line, prefixed with `- ` (dash followed by a space):

```yaml
tags:
  - javascript
  - webdev
  - open-source
```

A bare `-` with no following value produces `null`:

```yaml
values:
  -
  - hello
# → [null, 'hello']
```

Type coercion applies to each item.

**Object items:** A sequence item may be a mapping (object). The base indentation for sibling keys within an object item is the column of the first key following the `- ` prefix. All subsequent sibling keys must begin at that same column.

```yaml
authors:
  - name: Alice        # 'name' is at column 4 → base indentation = 4
    affiliation: MIT   # must also be at column 4
  - name: Bob
    affiliation: Stanford
```

Nested maps within array object items follow the same indentation model recursively.

**Nested sequences:** Array-in-array (nested block sequences) are not supported. In non-strict mode, the entire nested sequence block is consumed and represented by a single `null` item in the outer sequence — subsequent lines of the inner sequence are not reinterpreted as outer items. In strict mode, throw.

### 7.3 Block Mappings (Maps)

A block mapping is a set of key-value pairs at a consistent indentation level:

```yaml
author:
  name: Alice
  email: alice@example.com
```

Nested mappings are supported to any depth (within the limits of §9):

```yaml
params:
  social:
    twitter: alice
    github: alice-dev
```

Inline values and nested maps may be freely mixed within the same block.

A key with no inline value and no deeper indented content becomes `null`:

```yaml
params:
  empty:
  title: Hello
# → { empty: null, title: 'Hello' }

empty:
  # comment only, no content
next: value
# → { empty: null, next: 'value' }
```

### 7.4 Flow Sequences

A flow sequence is an inline list enclosed in square brackets:

```yaml
tags: [javascript, webdev, open-source]
```

**Empty flow sequence:** `[]` produces an empty sequence.

**Parsing rules:**
- Items are separated by commas at the current flow depth, outside quoted strings. A comma inside an immediately nested flow mapping does not separate items of the outer sequence.
- Whitespace around items and commas is trimmed.
- Quoted items may contain commas. Quoting rules follow §6.1.2 and §6.1.3.
- Type coercion applies to unquoted items. Quoted items are returned as strings without coercion.
- Trailing comma: non-strict — trailing empty element ignored; strict — throw.
- Leading or consecutive commas (empty elements): non-strict — empty element becomes `null`; strict — throw.
- An unclosed `[`: non-strict — string fallback for the entire value; strict — throw.
- An unclosed `[` containing a nested flow mapping (e.g. `[{name: Home, url: /}`): the outermost unclosed structure determines the fallback — non-strict: string fallback; strict: throw at the line of the opening `[`.

**Nesting:** Flow sequences may contain flow mappings (one level deep). Flow sequences may not contain other flow sequences, whether directly or via an intermediate flow mapping. The maximum permitted flow nesting depth is one level — any `[...]` or `{...}` construct nested inside another `[...]` or `{...}` at depth greater than one throws in both modes. This means `[{key: [1,2]}]` (SEQ → MAP → SEQ, depth 2) is also forbidden.

```yaml
menu: [{name: Home, url: /}, {name: About, url: /about}]  # ✓
matrix: [[1, 2], [3, 4]]                                   # ✗ — error in both modes
```

### 7.5 Flow Mappings

A flow mapping is an inline set of key-value pairs enclosed in curly braces:

```yaml
author: {name: Alice, role: editor}
```

**Empty flow mapping:** `{}` produces an empty mapping.

**Parsing rules:**
- Items are separated by commas at the current flow depth, outside quoted strings.
- Whitespace around items and commas is trimmed.
- Each item must have the form `key: value` — the separator is `: ` (colon followed by exactly one space). A colon not followed by a space is part of the value, not a separator.
- The first `: ` in each item is the separator. Everything after it is the value — colons in values are permitted: `{url: https://x:y}` → `url = 'https://x:y'`.
- Quoted keys follow the same rules as block quoted keys (§5.2).
- Type coercion applies to unquoted values. Quoted values are returned as strings without coercion.
- Trailing comma: non-strict — ignored; strict — throw.
- Leading or consecutive commas: non-strict — skipped; strict — throw.
- Missing `: ` separator: non-strict — string fallback for entire mapping; strict — throw.
- An unclosed `{`: non-strict — string fallback; strict — throw.

**Nesting:** Flow mappings may not contain other flow mappings or flow sequences. Invalid nesting throws in both strict and non-strict mode — silent fallback to a broken string is not acceptable.

---

## 8. Comments

A `#` character begins a comment when it appears outside a quoted string and is not escaped with a preceding backslash. Comment recognition uses the same quote-aware scanner defined in §4 (inline value processing) — it tracks quoted regions and respects escape rules. See §6.1.4 for the `\#` escape rule in unquoted values.

Comments are stripped from inline values at all levels: top-level scalars, values inside block mappings, and values inside block array items.

```yaml
title: My Article        # comment stripped
author:
  name: Alice            # comment stripped here too
  role: editor
```

`#` inside a quoted string is never a comment:

```yaml
link: "https://example.com/page#section"   # → 'https://example.com/page#section'
```

Comment lines (lines where the first non-whitespace character is `#`) are skipped entirely at any indentation level. They do not affect block structure or base indentation.

Multi-line `|` block scalar content: a `#` line that is more deeply indented than the introducing key is literal scalar content. A `#` line that is dedented to the key's indentation or less ends the scalar and is processed as a Lima comment (see §6.1.5).

---

## 9. Resource Limits

The following limits are enforced in both strict and non-strict mode. Exceeding any limit is a hard error in both modes — limits are security boundaries, not style preferences.

**Measurement conventions:**
- **Document size:** UTF-8 byte count of the original input, before normalisation.
- **Key and scalar length:** Unicode code point count, measured after escape decoding. Escape sequences left intact in non-strict mode are counted in their preserved literal form.
- **Nesting depth:** Defined recursively on the final parsed value tree. The document root mapping itself does not count as a level.

  ```
  depth(scalar)  = 0
  depth(array)   = 1 + max(depth(element) for each element), or 1 if empty
  depth(mapping) = 1 + max(depth(value) for each entry), or 1 if empty
  documentDepth  = max(depth(value) for each top-level entry)
  ```

  The limit `documentDepth ≤ 16` applies. Flow collections count identically to block collections. This definition is used for Core parsing, partial validation, and the final References output check.

- **Top-level key count:** All recognised top-level key entries, counted at parse time before duplicate resolution. Each occurrence of a duplicate key increments the counter.

| Resource | Limit |
|----------|-------|
| Document size | 64 KB (65,536 UTF-8 bytes) |
| Nesting depth (maps and arrays combined) | 16 levels |
| Number of top-level key entries | 128 |
| Key length | 128 Unicode code points |
| Scalar length | 16 KB (16,384 Unicode code points) |

When a limit is exceeded, the parser MUST throw an error with a descriptive message indicating which limit was exceeded and the 1-based line number where it was detected.

---

## 10. Strict Mode

Lima has two parse modes: non-strict (default) and strict.

**Non-strict** is tolerant by design. Unrecognised lines are skipped. Invalid syntax falls back to the nearest safe value. The mode is suitable for authoring environments where partial results are useful.

**Strict** adds a defined set of additional checks. The list is normatively closed — strict mode does not mean "validate everything". Constructs not on this list are handled identically in both modes.

### 10.1 Strict Error List

| Condition | Non-strict | Strict |
|-----------|-----------|--------|
| Duplicate key (any mapping level) | warn via `onWarning` + last wins | throw |
| Indented freetext without `\|` marker | `null` | throw |
| Invalid date value (component validation) | string fallback | throw |
| Float overflow to non-finite, or non-zero float underflow to zero | string fallback | throw |
| Flow mapping missing `: ` separator | string fallback for mapping | throw |
| Flow nesting deeper than one level | throw | throw |
| Unclosed `[` or `{` | string fallback | throw |
| Trailing comma in flow sequence or mapping | ignore | throw |
| Empty element in flow sequence or mapping | `null` / skip | throw |
| Unknown escape sequence (e.g. `\q`, `\z`) | leave intact (backslash preserved) | throw |
| Incomplete or invalid escape sequence (e.g. `\u12`, `\xZZ`) | leave intact | throw |
| Unterminated quoted string | string fallback | throw |
| Inconsistent indentation | skip | throw |
| Space before colon in quoted block key | skip | throw |
| Non-whitespace content after closing quote in an inline value | string fallback for entire value | throw |

### 10.2 Error Messages

All errors (strict and resource limit) MUST include:
- A descriptive message identifying the problem.
- The 1-based line number where the error occurs (`at line N`).

Non-strict duplicate key warnings delivered via `onWarning` MUST also include the line number.

---

## 11. API

### 11.1 Core Parse Function

```
parseCore(input: string, options?: CoreParseOptions): Record<string, unknown>
```

`input` is the raw Lima content between the frontmatter delimiters. Stripping delimiters is the caller's responsibility.

The return value is a prototype-free plain object (equivalent to `Object.create(null)` in JavaScript). Keys are strings. Values are one of: `string`, `number`, `boolean`, `Date` (UTC Instant, §6.5.3), `null`, `Array`, or a nested prototype-free mapping object. Member order is not semantically significant (see §1).

### 11.2 CoreParseOptions

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `strict` | `boolean` | `false` | Enable strict mode (§10) |
| `onWarning` | `(diagnostic: Diagnostic) => void` | `undefined` | Callback for non-strict warnings (e.g. duplicate keys). If not provided, warnings are silently discarded. |

**Diagnostic object:**

```
Diagnostic {
  message: string   // Human-readable description
  line:    number   // 1-based line number
}
```

Implementations MUST NOT emit warnings to any implicit output channel (e.g. `console.warn`). All diagnostics must be delivered via `onWarning`.

### 11.3 Errors

All errors thrown by the parser are plain `Error` instances with a descriptive `message` property. No custom error subclasses are required by this spec, but implementations may provide them.

---

## 12. Appendix A — What Lima Core Does Not Support

The following constructs are explicitly outside Lima Core. Their absence is intentional.

| Construct | Reason |
|-----------|--------|
| `>` folded block scalar | Confusing semantics; `\|` + `^^` covers the use case |
| Chomping indicators (`\|-`, `\|+`) | Not needed without `>` |
| Nested flow structures (depth > 1) | Not needed for frontmatter; block syntax is clearer |
| Nested sequences (array-in-array) | No real frontmatter use case |
| Space separator in ISO datetime | Non-standard; `T` separator required for ISO forms |
| Milliseconds in dates | No frontmatter use case |
| Timezone offset with German/slash date formats | Ambiguous; ISO 8601 required for timezone-aware values |
| American date format `MM/DD/YYYY` | Ambiguous without locale |
| British date format `DD/MM/YYYY` | Ambiguous without locale |
| Year 0000 and negative years | Edge case in host libraries; 0001–9999 sufficient for all real dates |
| UTC offsets beyond ±14:00 | No real timezone exceeds this range |
| `\0` escape sequence | Treated as unknown escape — non-strict: intact; strict: throw. Use `\u0000` if a null codepoint is genuinely needed |
| `partials` option in Core API | References Extension only — see §13 |
| YAML anchors and aliases (`&`, `*`) | Out of scope |
| YAML tags (`!!str`, `!!int`) | Out of scope |
| Multi-document streams (`---`, `...`) | Out of scope |
| Transitive references | References Extension only; one hop maximum |
| BigInt / arbitrary-precision integers | Not part of Lima type system |
| Non-finite float output | Lima never produces `Infinity` or `NaN`. The literal strings `Infinity` and `NaN` are never parsed as numbers (grammar mismatch). A syntactic float that overflows to a non-finite value falls back to string in non-strict mode and throws in strict mode (see §6.4.2 and §10.1). |

---

## 13. Appendix B — Lima Core vs. References Extension

Lima Core defines the data format. The References Extension defines an optional resolution layer on top.

A **Lima Core conforming parser** implements `parseCore` as defined in §11. It does not need to implement reference resolution. `($key)` and `(%key)` tokens — using the document sigil `$` and partial sigil `%` respectively — are plain strings to a Core parser.

The complete syntax, semantics, error behaviour, resource checks, and API additions of the optional References Extension are defined exclusively in the **Lima References 1.0 specification**. In case of any discrepancy between this appendix and that document, the References specification is authoritative.

For implementors: the References Extension adds `parseReferences()`, validates and deep-copies all partial values before parsing, marks reference tokens as active during syntactic parsing, and resolves them in two snapshot-based phases after Core parsing is complete.

---

## 14. Appendix C — Design Principles

1. **Lima is a data format with convenience features, not an evaluation system.** References and partials are author convenience, not a programming language. Features that move Lima toward a template language or evaluation system do not belong in Core.

2. **The YAML subset is the product. References and partials are features.** Lima Core is a complete and useful format without references. The extension layer must not take over the identity of Core.

3. **The spec is implementation-language-agnostic.** No rule may depend on host-language-specific behaviour. Every rule must be precise enough for a Rust implementation to follow directly.

### Implementation Notes

These notes document known engineering trade-offs that arise from the design decisions above. They are not normative.

**Float serialisation (References Extension only)**
The canonical float serialisation (References §3.5.1) is normatively defined via the ECMAScript `Number::toString` algorithm, including its fixed-versus-exponential thresholds (exponent range −6 to 20). This is a deliberate trade-off: it guarantees cross-language output parity at the cost of additional engineering effort in non-JavaScript implementations. A Rust implementation must reproduce these thresholds exactly — using Ryu or Dragonbox internally is fine, but the fixed/exponential boundary and the digit sequence must match ECMAScript semantics. This is the one place where the spec is normatively ECMAScript-anchored; all other rules are language-neutral.

**Source position tracking (References Extension only)**
References §4.1 requires source position metadata (line number and character offset) for every key in the document, including keys nested at arbitrary depth, in order to apply the phase-1 resolution rule correctly for dotted paths. A minimal streaming parser that deserialises directly into output structures without an intermediate representation cannot satisfy this requirement. Implementations of the References Extension must retain an internal structure that preserves source positions for all keys until phase 2 is complete. This is an intentional trade-off: deterministic phase-1 resolution requires this metadata.

**Partial validation overhead**
Partial values are fully validated and deep-copied before document parsing begins (References §6.2). For host applications that pass large partial objects of which only a small fraction is actually referenced in a given document, this validation occurs on every parse call regardless of usage. If this overhead is measurable, the recommended approach is to pre-validate and cache the deep-copied Lima partial structure on the host side, and pass the already-validated copy to `parseReferences` — avoiding repeated validation of the same partial data.

---

## 15. Appendix D — Normative Grammar

### 15.1 Scope and Precedence

This appendix gives a consolidated EBNF description of Lima Core syntax. It is normative for the forms it describes, but it does not replace the procedural rules in the main specification.

The grammar describes the token and structural shape of valid Lima input after the normalisation steps in §3. The following remain governed by the cited prose sections:

- indentation measurement and block ownership (§7.1),
- quote-aware comment stripping and inline-value processing (§4 and §8),
- scalar type conversion and validation (§6),
- strict and non-strict fallback behaviour (§10),
- duplicate handling and resource limits (§5.3 and §9).

If this appendix and a procedural rule in the main specification appear to conflict, the procedural rule is authoritative.

### 15.2 Notation

The grammar uses ISO-style EBNF conventions:

```ebnf
rule        = expression ;
alternative = first | second ;
sequence    = first, second ;
optional    = [ expression ] ;
repetition  = { expression } ;
group       = ( expression ) ;
```

Quoted text denotes a literal terminal. `? ... ?` denotes a lexical condition or token supplied by the scanner.

The scanner operates on the normalised input and supplies these structural tokens:

```ebnf
NL      = ? U+000A line ending ? ;
INDENT  = ? entry into a deeper block level under §7.1 ? ;
DEDENT  = ? return to a shallower block level under §7.1 ? ;
EOF     = ? end of input ? ;
```

Blank lines and comment-only lines are ignored by the structural grammar except while collecting block-scalar content. They do not produce `INDENT` or `DEDENT` transitions.

### 15.3 Document and Block Structure

```ebnf
document          = { top-level-entry | ignored-line }, EOF ;

top-level-entry    = mapping-entry ;

block-value        = block-mapping
                   | block-sequence ;

block-mapping      = mapping-entry, { mapping-entry | ignored-line } ;

mapping-entry      = key, inline-separator, block-scalar-marker, NL,
                     [ INDENT, block-scalar-body, DEDENT ]
                   | key, inline-separator, inline-value, NL
                   | key, block-separator, NL,
                     [ INDENT, block-value, DEDENT ] ;

block-sequence     = sequence-entry, { sequence-entry | ignored-line } ;

sequence-entry     = "-", [ " ", sequence-value ], NL,
                     [ INDENT, sequence-continuation, DEDENT ] ;

sequence-value     = inline-value
                   | object-entry-head ;

object-entry-head  = key, inline-separator, inline-value
                   | key, block-separator ;

sequence-continuation
                  = block-mapping ;

ignored-line       = ? blank or comment-only line outside a block scalar ? ;
```

`mapping-entry` and `sequence-entry` are accepted only when their indentation corresponds to the current block level under §7.1. The first content line establishes the base indentation of a block. The grammar therefore does not assign a fixed number of spaces to `INDENT`.

A sequence item beginning with `object-entry-head` starts an object item. Subsequent sibling keys belong to that object only when they use the base indentation defined in §7.2.

### 15.4 Keys and Separators

```ebnf
key                = unquoted-key | single-quoted-key | double-quoted-key ;

unquoted-key       = key-initial, { key-character } ;
key-initial        = ASCII-letter | decimal-digit | "_" ;
key-character      = key-initial | ":" | "-" ;

single-quoted-key  = "'", { single-quoted-key-character }, "'" ;
double-quoted-key  = '"', { double-quoted-character }, '"' ;

inline-separator   = ":", " " ;
block-separator    = ":" ;
```

For an unquoted key, the separator is the first `: ` outside a quoted key, as specified in §5.1. A colon not followed by a space remains part of an unquoted key. For a quoted key, the separator must immediately follow the closing quote (§5.2).

### 15.5 Inline Values

```ebnf
inline-value       = quoted-string
                   | flow-sequence
                   | flow-mapping
                   | unquoted-source ;

quoted-string      = single-quoted-string | double-quoted-string ;

single-quoted-string
                  = "'", { single-quoted-character }, "'" ;

double-quoted-string
                  = '"', { double-quoted-character }, '"' ;

unquoted-source    = ? non-newline source text processed by the
                       quote-aware pipeline in §4 ? ;
```

`unquoted-source` ends before the first unescaped `#` outside quoted regions. After comment removal and trimming, the resulting token is converted according to the scalar order in §6. An empty result produces `null`.

### 15.6 Quoted Characters and Escapes

```ebnf
single-quoted-character
                  = "\\'"
                   | ? any character except U+000A and an unescaped "'" ? ;

single-quoted-key-character
                  = single-quoted-character ;

double-quoted-character
                  = escape-sequence
                   | ? any character except U+000A, '"', and "\\" ? ;

escape-sequence    = "\\\\" | "\\\"" | "\\/"
                   | "\\n" | "\\r" | "\\t" | "\\b" | "\\f"
                   | "\\u", hex-digit, hex-digit, hex-digit, hex-digit
                   | "\\U", hex-digit, hex-digit, hex-digit, hex-digit,
                              hex-digit, hex-digit, hex-digit, hex-digit
                   | "\\x", hex-digit, hex-digit ;
```

Unicode-range checks and strict/non-strict handling of malformed or unknown escapes are defined in §6.1.2 and §10.

### 15.7 Block Scalars

```ebnf
block-scalar-marker
                  = "|" ;

block-scalar-body  = { block-scalar-line } ;

block-scalar-line  = ? a physical line whose indentation is strictly
                       greater than that of the introducing key, or an
                       intervening empty line, under §6.1.5 ? ;
```

A block scalar is selected only when the complete inline value after the separator is exactly `|`. Content indentation removal, trailing-strip behaviour, and `^^` continuation processing are defined in §6.1.5–§6.1.6.

### 15.8 Flow Collections

```ebnf
flow-sequence      = "[", [ flow-sequence-items ], "]" ;
flow-sequence-items
                  = flow-sequence-item,
                    { ",", flow-sequence-item } ;
flow-sequence-item = flow-scalar | flow-mapping ;

flow-mapping       = "{", [ flow-mapping-items ], "}" ;
flow-mapping-items = flow-mapping-item,
                    { ",", flow-mapping-item } ;
flow-mapping-item  = flow-key, inline-separator, flow-scalar ;

flow-key           = key ;
flow-scalar        = quoted-string | unquoted-flow-source ;
unquoted-flow-source
                  = ? source text up to a current-depth comma or closing
                       delimiter, outside quoted strings ? ;
```

Leading, consecutive, and trailing commas are recovery cases rather than valid grammar productions. Their mode-dependent handling is defined in §7.4–§7.5 and §10.

The nesting restrictions in §7.4–§7.5 are additional constraints: a flow sequence may contain flow mappings at one level; flow mappings may not contain flow collections; and flow nesting deeper than one level throws in both modes.

### 15.9 Scalar Lexemes

The following productions describe scalar forms before semantic range and calendar validation:

```ebnf
null-literal       = "null" | "~" ;
boolean-literal    = "true" | "false" ;

number             = [ "-" ], significand, [ exponent ] ;
significand        = integer-part | decimal | leading-decimal ;
integer-part       = "0" | nonzero-digit, { decimal-digit } ;
decimal            = integer-part, ".", decimal-digit, { decimal-digit } ;
leading-decimal    = ".", decimal-digit, { decimal-digit } ;
exponent           = ( "e" | "E" ), [ "+" | "-" ],
                     decimal-digit, { decimal-digit } ;

iso-date           = year4, "-", digit2, "-", digit2 ;
iso-time           = digit2, ":", digit2, [ ":", digit2 ] ;
iso-offset         = "Z"
                   | ( "+" | "-" ), digit2, ":", digit2 ;
iso-datetime       = iso-date, "T", iso-time, [ iso-offset ] ;

german-date       = digit1-or-2, ".", digit1-or-2, ".", year4 ;
german-datetime   = german-date, " ", iso-time ;

slash-date        = year4, "/", digit2, "/", digit2 ;
slash-datetime    = slash-date, " ", iso-time ;

date-literal      = iso-date | iso-datetime
                   | german-date | german-datetime
                   | slash-date | slash-datetime ;
```

The productions recognise lexical shapes only. Numeric range, overflow, underflow, safe-integer checks, date-component validation, UTC conversion, and year bounds remain governed by §6.4–§6.5.

### 15.10 Character Classes

```ebnf
ASCII-letter       = "A" | "B" | "C" | "D" | "E" | "F" | "G"
                   | "H" | "I" | "J" | "K" | "L" | "M" | "N"
                   | "O" | "P" | "Q" | "R" | "S" | "T" | "U"
                   | "V" | "W" | "X" | "Y" | "Z"
                   | "a" | "b" | "c" | "d" | "e" | "f" | "g"
                   | "h" | "i" | "j" | "k" | "l" | "m" | "n"
                   | "o" | "p" | "q" | "r" | "s" | "t" | "u"
                   | "v" | "w" | "x" | "y" | "z" ;

decimal-digit      = "0" | "1" | "2" | "3" | "4"
                   | "5" | "6" | "7" | "8" | "9" ;
nonzero-digit      = "1" | "2" | "3" | "4" | "5"
                   | "6" | "7" | "8" | "9" ;
hex-digit          = decimal-digit
                   | "A" | "B" | "C" | "D" | "E" | "F"
                   | "a" | "b" | "c" | "d" | "e" | "f" ;
digit2             = decimal-digit, decimal-digit ;
digit1-or-2        = decimal-digit, [ decimal-digit ] ;
year4              = decimal-digit, decimal-digit,
                     decimal-digit, decimal-digit ;
```
