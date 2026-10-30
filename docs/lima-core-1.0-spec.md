# Lima Core 1.2 — Normative Specification

> **Status:** Draft · **Version:** 1.2.0 · **Date:** —

This document is the normative specification for Lima Core 1.2. It defines the syntax, semantics, and error behaviour of the Lima frontmatter format. All conforming implementations must produce identical output for any given valid input.

Lima is not a general-purpose data format. It is a small, predictable frontmatter format — the part of YAML that frontmatter actually needs, with well-defined types and no surprises.

**Changes from Core 1.1:** an unquoted key may be written in any script: it starts with a letter or number of Unicode 18.0 or with `_`, and after its first character it may also hold marks, as accents can be written, and `*` and `·`, as gendered words such as `autor*in` and `autor·in` are written (§5.1). Lima delivers and compares a key as it is written, code point by code point, and normalises no Unicode (§5.3). A key Core 1.1 recognised reads the same in Core 1.2; a line whose unquoted key holds characters that Core 1.2 admits and Core 1.1 did not, and which Core 1.1 therefore did not read as an entry, is an entry now when it otherwise has the form of an entry and stands where an entry may. For clarity, §1 now says what UTF-8 implies: a string with a lone surrogate is no document, and a parser rejects it. §7.1 states what each kind of line does where it stands in one table, in place of the paragraph that said it in prose; no outcome changes. In step with it, §6.1.5 and §10.1 say that indented freetext after a bare key leaves the key `null` only when no later line of its block is a member, as Core 1.1's §7.1 already said, and §10.1 lists every other line the table has strict mode reject.

**Changes from Core 1.0** (errata 1.0.10): strict mode rejects a content line that belongs to no structure, which Core 1.0 skipped in both modes — a line indented where no block level is open, at the top level as one level down (§7.1 rule 5), an unindented line that matches no key pattern (§4), and a line of a block mapping whose key the key grammar rejects (§5.1). Non-strict mode skips these lines, as before. Core 1.1 also settles what Core 1.0 left unsaid, where implementations differed: a bare key's sequence may start at the key's own column, as YAML writes it (§7.2); a block holds mapping entries or sequence items, as its first entry or item decides, and a line non-strict mode skips ends neither the block nor the object item before it unless it is less indented (§7.1); an item whose value is a flow sequence is a nested sequence (§7.2); a `|` with no content lines is `''` (§6.1.5); indentation is spaces only, so a line indented by other whitespace, such as U+00A0, is unrecognised (§7.1), with whitespace defined once (§1); and the end of the input ends the last line as a line terminator does (§4), so a last `key:` is a bare key.

---

## 1. Definitions

**Document:** A UTF-8 encoded string of Lima frontmatter content, without the surrounding `---` delimiters. Stripping delimiters is the caller's responsibility. Its characters are Unicode scalar values, as UTF-8 encodes no other: a string that holds a lone surrogate, which some host languages can, is no document, and a parser rejects it with an error in both modes.

**Key:** A named field in a Lima document.

**Value:** The data associated with a key. Values have a type determined by the parsing rules in §6.

**Scalar:** A single atomic value: string, number, boolean, date, or null.

**Block scalar:** A multi-line string introduced by a `|` marker. A block scalar is a scalar, not a block structure.

**Block structure:** A mapping or sequence written across multiple indented lines.

**Mapping:** A collection of key-value members. Member order is not semantically significant — consumers must not rely on enumeration order. A formatter may preserve source order.

**Sequence:** An ordered list of values. Also called an array.

**Flow form:** An inline mapping (`{...}`) or sequence (`[...]`) written on a single line.

**Block form:** A mapping or sequence written across multiple indented lines.

**Whitespace:** The characters U+0009, U+000A–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF — ECMAScript's WhiteSpace and LineTerminator. A blank line is a line of whitespace only. Indentation is spaces only (§7.1).

**UTC Instant:** An abstract point in time expressed in UTC with second precision and zero milliseconds. The concrete representation depends on the host language (see §6.5.3).

**Reference:** A token of the optional References extension (Appendix B): `${document-path}`, a document reference, or `$(partial-name)` with an optional dotted path, a partial reference, as the References specification defines them. Meaningful only to a References parser; treated as literal string content by a Lima Core parser.

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

The separator between key and value is `: ` (colon followed by a single space) for inline values, or `:\n` (colon followed by a newline) for block values. Trailing spaces after the colon are ignored. The end of the input ends the last line as a line terminator does: a last `key:` is a bare key, `null` without a block.

**Inline value processing:** The inline value scanner processes the full source value while respecting quote boundaries:

1. Scan left-to-right, tracking quoted regions (single and double quotes with their respective escape rules).
2. The first unescaped `#` outside a quoted region begins a comment — it and everything following it are removed.
3. Trim leading and trailing spaces from the remaining text.
4. If the remaining text begins with a quote character, it is a quoted value **only** when the matching closing quote is the final remaining character after trimming. Any non-whitespace content after the closing quote is invalid: non-strict mode falls back to a string (the entire remaining text), strict mode throws.
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

An unindented line that does not match any key pattern, and is no item of a compact sequence (§7.2), is unrecognised: non-strict mode skips it silently, strict mode throws (see §10.1). An indented line that is not part of a block value is inconsistently indented (§7.1 rule 5).

---

## 5. Key Syntax

### 5.1 Unquoted Keys

An unquoted key starts with a letter, a number or `_`. After that it holds letters, marks, numbers and the characters `_`, `:`, `-`, `*` and `·` (U+00B7 MIDDLE DOT):

```
key-initial    a letter or a number of any script, or _
key-character  a key-initial, a mark, or one of : - * ·
```

Letters, marks and numbers are the characters whose general category in the Unicode Character Database 18.0.0 is L, M or N; numbers include more than decimal digits, such as Roman numerals. The version is fixed, so that every implementation reads a key alike, whatever version of Unicode its host language knows: a character that Unicode 18.0 does not assign is no letter, mark or number. Whitespace (§1), control characters and format characters, among them U+200B–U+200F and the bidirectional controls U+202A–U+202E and U+2066–U+2069, are in none of these categories and in no unquoted key; a key that holds them must be quoted (§5.2).

Valid examples: `title`, `firstName`, `h1`, `_draft`, `snake_case`, `kebab-case`, `og:title`, `1st`, `42`, `größe`, `título`, `autor:in`, `autor*in`, `autor·in`, `заголовок`, `題名`

**Key-value separator rule:** Since unquoted keys may contain colons, the key-value separator is the first `: ` (colon followed by exactly one space) or `:\n` (colon followed by a newline, or the end of the input, §4) that is not inside a quoted key. Everything before it is the key; everything after is the value.

A line with a separator whose key matches neither this pattern nor a quoted key (§5.2) is unrecognised (§4): skipped in non-strict mode, an error in strict mode — at the top level and in a block mapping alike.

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

A raw line terminator inside a quoted key is not a valid quoted-key character (§15.6, which excludes U+000A from both single- and double-quoted-key characters). A physical line whose quoted key does not close on that same line is unrecognised (§4): skipped in non-strict mode, an error in strict mode. The `\n` escape in a double-quoted key is unaffected: it decodes to a key containing U+000A, exactly as in a double-quoted value.

### 5.3 Duplicate Keys

Duplicate keys are invalid at all mapping levels (top-level, nested maps, flow mappings, object arrays), with mode-dependent handling:

- **Non-strict:** Emit a warning via `onWarning`. Last value wins.
- **Strict:** Throw. Error message includes the key name and 1-based line number.

Two keys are the same key when they are the same sequence of code points. Lima normalises no Unicode: `größe` written with U+00F6 and `größe` written with `o` and U+0308 COMBINING DIAERESIS are two keys, and each is delivered as it is written. A consumer that wants them to be one normalises the keys itself.

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
| --- | --- |
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
| --- | --- | --- |
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

**Backslash pairing.** When the closing quote is located, the content is scanned left to right and each backslash is taken together with the character after it: `\\` is a two-character run of literal backslashes, and `\'` is an escaped quote. The second backslash of a `\\` run therefore cannot combine with a following quote to form `\'`. A closing `'` preceded by an even number of backslashes (zero included) ends the string; a `'` preceded by an odd number of backslashes is the `\'` escape — so a single-quoted value whose content would otherwise end in an odd run of backslashes is an unterminated string (§10.1) and takes the fallback below.

Inside single-quoted strings, `#` is never a comment.

| Condition | Non-strict | Strict |
| --- | --- | --- |
| Unterminated string (no closing `'`) | String fallback (from opening quote to end of line) | throw |

#### 6.1.4 Unquoted Value Comment Escaping

In unquoted values, `\#` is an escaped hash: the backslash is removed and `#` is kept as a literal character (not a comment). Only the immediately preceding backslash is considered — earlier backslashes are not counted.

| Input | Result | Reason |
| --- | --- | --- |
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

**Block scalar extent:** A line belongs to a block scalar if and only if its indentation is strictly greater than the indentation of the key that introduced the scalar. This rule applies to all lines, including lines beginning with `#`. An indented `#` line is literal scalar content; a dedented `#` line ends the scalar and is processed as a Lima comment by the surrounding structure. Empty lines between scalar content lines belong to the scalar regardless of their indentation. An empty line here is one of spaces only, or none: other whitespace, such as U+00A0, is scalar content, and a line of it at the key's column or less ends the scalar like any content line.

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

**Trailing content:** All trailing empty lines and newlines at the end of a block scalar are removed (strip behaviour). The parsed value ends with the final non-empty content line and contains no trailing newline. A `|` with no content lines, at the end of the input too, is the empty string `''`. Tabs within the final content line are preserved — only trailing empty lines and newlines are stripped, not whitespace within lines.

**Inline content without `|`:** Indented freetext without a `|` marker is not a valid multi-line string. It is an other line of §7.1: after a bare key it opens the key's block but adds nothing to it.

- Non-strict: the line is skipped; the key is `null` unless a later line of its block is a member (§7.1).
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
- A line that must literally begin with `^^` cannot be represented in Lima Core — this is a documented limitation.

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
| --- | --- |
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
| --- | --- |
| Date only | `2024-03-01` |
| Date + time | `2024-03-01T09:00` |
| Date + time + seconds | `2024-03-01T09:00:00` |
| Date + time + seconds + Z | `2024-03-01T09:00:00Z` |
| Date + time + offset | `2024-03-01T09:00+02:00` |
| Date + time + seconds + offset | `2024-03-01T09:00:00+02:00` |

The `T` separator between date and time is required for ISO forms. A space separator is not accepted for ISO forms.

**German format** (`DD.MM.YYYY` or `D.M.YYYY`) — no offset, always UTC:

| Form | Example |
| --- | --- |
| Date only | `01.03.2024` or `1.3.2024` |
| Date + time | `01.03.2024 14:33` |
| Date + time + seconds | `01.03.2024 14:33:00` |

Day and month may be one or two digits. A space separator between date and time is required.

**Slash format** (`YYYY/MM/DD`) — no offset, always UTC:

| Form | Example |
| --- | --- |
| Date only | `2024/03/01` |
| Date + time | `2024/03/01 14:33` |
| Date + time + seconds | `2024/03/01 14:33:00` |

Month and day must be two digits in slash format. A space separator between date and time is required.

#### 6.5.2 Component Validation

All date and time components are validated individually. Dates use the proleptic Gregorian calendar. Years range from 0001 through 9999.

| Component | Valid range | Notes |
| --- | --- | --- |
| Year | 0001–9999 |  |
| Month | 1–12 | ISO and slash: exactly two digits in the format pattern (e.g. `03`, not `3`); German: one or two digits |
| Day | 1–last day of month | Calendar-aware including leap years; ISO and slash: exactly two digits in the format pattern; German: one or two digits |
| Hour | 00–23 |  |
| Minute | 00–59 |  |
| Second | 00–59 | Leap seconds not supported |
| Offset hour | 00–14 |  |
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
| --- | --- |
| JavaScript/TypeScript | `Date` (milliseconds always 0) |
| JSON serialisation | RFC 3339 string (`2024-03-01T09:00:00Z`) |
| Rust | `Instant { epoch_seconds: i64 }` (seconds since the Unix epoch) |
| Go | `Instant{ EpochSeconds int64 }` (seconds since the Unix epoch) |

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
5. A line whose indentation does not correspond to any currently open block level is inconsistently indented — silently skipped in non-strict; throw in strict. This holds at the top level as at any other: a key with an inline value opens no block, so a line indented after it corresponds to no open block level.
6. Empty lines (blank or whitespace-only) do not affect base indentation and are skipped.
7. Comment lines (first non-whitespace character is `#`) do not affect base indentation and are skipped.

What each kind of line does where it stands is the table below; rules 1–7 name its terms, and §6.1.5 and §7.2 define the structures it refers to. The document is a block mapping at column 0, so the rows for a block hold at the top level too.

**Kinds of line.** A **blank line** holds whitespace only (§1). A **comment line** has `#` as its first non-whitespace character. An **entry** is a key and its separator (§4, §5): with an inline value, or a **bare key** with none. An **item** is `-` alone or `-` followed by whitespace (§7.2): with a value, or a **bare item** `-` alone; an **object item** is an item whose value starts with an entry, and its **key column** is that entry's column. An **other line** is any other line with content: freetext, a key the key grammar rejects (§5.1), a quoted key that does not close on its line or has a space before its colon (§5.2), `---`, and a line whose content starts after whitespace other than spaces. A line's **column** is its indentation, the run of spaces at its start.

The rows of the innermost structure open at a line apply: a `|` scalar before the first line after a bare key, that before an object item or a compact sequence, and those before the block they stand in.

| Where the line stands | Line | Non-strict | Strict |
| --- | --- | --- | --- |
| In a `\|` scalar of a key at column *k* (§6.1.5) | An empty line (spaces only, or none) | Content of the scalar | Same |
| | Any non-empty line at a column deeper than *k* | Content of the scalar, a `#` line included | Same |
| | A line with content at column *k* or less | Ends the scalar; read where it stands | Same |
| First line with content after a bare key at column *k* | An entry or an item deeper than *k* | Opens the key's block: the line's column is its base indentation, its kind decides whether the block holds entries or items | Same |
| | An other line deeper than *k* | Opens the key's block and sets its base indentation, but decides nothing about what it holds; skipped | Throw |
| | An item at column *k* | Opens the key's compact sequence (§7.2) | Same |
| | Any remaining line at column *k* or less | The key is `null`; the line is read where it stands | Same |
| In a block of base indentation *b* | An entry or an item at column *b*, while the block holds nothing yet or holds that kind | A member of the block; the first decides what the block holds | Same |
| | An entry or an item of the other kind at column *b* | Skipped; the block keeps its kind | Throw |
| | An other line at column *b* | Skipped | Throw |
| | A line deeper than *b* after a bare key | As the first line after a bare key (above) | Same |
| | Any remaining line deeper than *b* — after an inline value, after an item or a bare item, or at the top level with no block open | Inconsistently indented (rule 5): skipped; the block goes on | Throw |
| | A line less indented than *b* | Ends the block; read in the enclosing block by these rows | Same |
| In an object item, its dash at column *d* and its key column *c* | An entry at column *c* | A member of the item's mapping | Same |
| | An item or an other line at column *c* | Skipped | Throw |
| | A line deeper than *c* after a bare key | As the first line after a bare key (above) | Same |
| | Any remaining line deeper than *c* | Inconsistently indented: skipped; the item goes on | Throw |
| | A line deeper than *d* and less indented than *c* | Inconsistently indented: ends the item; skipped | Throw |
| | A line at column *d* or less | Ends the item; read in the sequence by the rows for a block | Same |
| In a compact sequence of a key at column *k* | An item at column *k* | The next item | Same |
| | A line deeper than *k* | As in a block of items of base indentation *k* | Same |
| | Any remaining line with content at column *k* or less | Ends the sequence; read where it stands | Same |
| Anywhere but in a `\|` scalar | A blank line or a comment line | Skipped; it ends nothing and sets no base indentation | Same |

A key whose block ends with no member is `null`, as a bare key with no deeper line is (§7.3). A skipped line is no member: it ends a block, an item or a sequence only where the table says so, by its column.

Minimum indentation is one space. There is no required indentation increment — two spaces is conventional but not normative.

Indentation is the run of spaces at the start of a line, after §3 has replaced its tabs. Other whitespace there, such as U+00A0, is no indentation: on a line with content, it starts the content, so the line is no entry and no item but an unrecognised line (§4, §5.1), skipped in non-strict mode and an error in strict mode, and its indentation is its spaces. A blank line stays empty (rule 6), and a line whose first non-whitespace character is `#` a comment line (rule 7), whatever whitespace precedes it. In a `|` scalar such whitespace is content (§6.1.5).

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

**Object items:** A sequence item may be a mapping (object). The base indentation for sibling keys within an object item is the column of the first key following the `- ` prefix. All subsequent sibling keys must begin at that same column. A line of the item that no nested block or `|` scalar takes, at another column deeper than the dash, is inconsistently indented (§7.1 rule 5): deeper than the key column, it is skipped in non-strict mode and the item goes on; less indented, it ends the item (§7.1 rule 4). Strict mode throws for either.

```yaml
authors:
  - name: Alice        # 'name' is at column 4 → base indentation = 4
    affiliation: MIT   # must also be at column 4
  - name: Bob
    affiliation: Stanford
```

Nested maps within array object items follow the same indentation model recursively.

**Nested sequences:** Array-in-array (nested block sequences) are not supported. In non-strict mode, the entire nested sequence block is consumed and represented by a single `null` item in the outer sequence — subsequent lines of the inner sequence are not reinterpreted as outer items. In strict mode, throw. An item's value is an inline value (§15.3), so an item whose value is a flow sequence, such as `- [a, b]` or `- []`, is a nested sequence too: non-strict `null`, strict throw. Any other item value that begins with `[` or `{` is read as any inline value is (§7.4, §7.5: an unclosed `[` or `{` is a string fallback in non-strict mode and throws in strict mode).

**Compact sequences:** A bare key's sequence may also start at the key's own column, as YAML front matter often writes it:

```yaml
tags:
- javascript
- webdev
title: Hello
```

→ `tags = ['javascript', 'webdev']`, `title = 'Hello'`

This holds at any level, the key of an object item included. A line is a sequence item when it is `-` alone or `-` followed by whitespace; `---` and `-x` are not. A compact sequence ends at the first content line in its key's column that is not an item. Only a bare key opens one: after a key with an inline value, an item in the key's column belongs to no value — unrecognised at the top level (§4), a line of the other kind in a block mapping (§7.1).

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
- Each item must have the form `key: value` — the separator is `: ` (colon followed by exactly one space). A colon not followed by a space is no separator: before the first `: ` it is part of an unquoted key (§5.1), after it part of the value.
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
| --- | --- |
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
| --- | --- | --- |
| Duplicate key (any mapping level) | warn via `onWarning` + last wins | throw |
| Indented freetext first after a bare key, without a `\|` marker | skip; the key is `null` unless its block gains a member (§7.1) | throw |
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
| Inconsistent indentation (§7.1 rule 5, at any level) | skip | throw |
| A sequence item in a block of mapping entries, or the reverse (§7.1) | skip | throw |
| Nested sequence, in block or flow form (§7.2) | `null` item | throw |
| Unrecognised line: an unindented line that matches no key pattern (§4), or a line of a block mapping whose key the key grammar rejects (§5.1) | skip | throw |
| An other line (§7.1) where the table of §7.1 says Throw, such as freetext or `---` at the base indentation of a block of items | skip | throw |
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
| --- | --- | --- | --- |
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
| --- | --- |
| `>` folded block scalar | Confusing semantics; `\|` + `^^` covers the use case. The lines that follow the marker are inconsistently indented (§7.1 rule 5) |
| Chomping indicators (`\|-`, `\|+`) | Not needed without `>`. The lines that follow the marker are inconsistently indented (§7.1 rule 5) |
| Nested flow structures (depth > 1) | Not needed for frontmatter; block syntax is clearer |
| Nested sequences (array-in-array) | No real frontmatter use case. A nested sequence is a `null` item in non-strict mode and throws in strict mode (§7.2) |
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
| Multi-document streams (`---`, `...`) | Out of scope. A `---` or `...` line is unrecognised (§4) |
| Transitive references | References Extension only; at most three reference edges (References §4.2) |
| BigInt / arbitrary-precision integers | Not part of Lima type system |
| Non-finite float output | Lima never produces `Infinity` or `NaN`. The literal strings `Infinity` and `NaN` are never parsed as numbers (grammar mismatch). A syntactic float that overflows to a non-finite value falls back to string in non-strict mode and throws in strict mode (see §6.4.2 and §10.1). |

---

## 13. Appendix B — Lima Core vs. References Extension

Lima Core defines the data format. The References Extension defines an optional resolution layer on top.

A **Lima Core conforming parser** implements `parseCore` as defined in §11. It does not need to implement reference resolution. `${key}` and `$(partial)` tokens are plain strings to a Core parser.

The complete syntax, semantics, error behaviour, resource checks, and API additions of the optional References Extension are defined exclusively in the **Lima References 2.1 specification**; References 1.0 is frozen and normative only for its own conformance corpus. In case of any discrepancy between this appendix and the References specification, the References specification is authoritative.

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
References orders the errors associated with source tokens by the source position (line number and character offset) of the token, and a token copied by a pure reference keeps the position of its original spelling (References §4.4, §5). A minimal streaming parser that deserialises directly into output structures without an intermediate representation cannot satisfy this requirement. Implementations of the References Extension must retain every active token's source position and insertion provenance until resolution and final-result validation are complete. This is an intentional trade-off: deterministic error reporting requires this metadata.

**The characters of a key**
An unquoted key's letters, marks and numbers are the general categories of Unicode 18.0 (§5.1). A host language's own Unicode support follows the version it was built with, and Rust's standard library has no test for a mark; so every implementation carries its own table of the three categories, generated from the Unicode Character Database 18.0.0, rather than a dependency. Reading a key byte by byte while it is ASCII, and looking a category up only for a code point beyond U+007F, keeps a document of ASCII keys as fast as before.

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
NL      = ? U+000A line ending; the last line of the input needs none (§4) ? ;
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
                     [ INDENT, block-value, DEDENT ]
                   | key, block-separator, NL, block-sequence ;

block-sequence     = sequence-entry, { sequence-entry | ignored-line } ;

sequence-entry     = "-", [ item-separator, sequence-value ], NL,
                     [ INDENT, sequence-continuation, DEDENT ] ;

sequence-value     = inline-value
                   | object-entry-head ;

object-entry-head  = key, inline-separator, inline-value
                   | key, block-separator ;

sequence-continuation
                  = block-mapping ;

item-separator     = ? one or more whitespace characters (§1, §7.2) other
                       than U+000A, which alone ends a line after §3 ? ;

ignored-line       = ? blank or comment-only line outside a block scalar ? ;
```

`mapping-entry` and `sequence-entry` are accepted only when their indentation corresponds to the current block level under §7.1. The first content line establishes the base indentation of a block. The grammar therefore does not assign a fixed number of spaces to `INDENT`.

The last form of `mapping-entry` is a compact sequence: its items start at the key's own column (§7.2), and it ends at the first content line there that is not a `sequence-entry`.

A sequence item beginning with `object-entry-head` starts an object item. Subsequent sibling keys belong to that object only when they use the base indentation defined in §7.2.

### 15.4 Keys and Separators

```ebnf
key                = unquoted-key | single-quoted-key | double-quoted-key ;

unquoted-key       = key-initial, { key-character } ;
key-initial        = unicode-letter | unicode-number | "_" ;
key-character      = key-initial | unicode-mark
                   | ":" | "-" | "*" | "·" ;

single-quoted-key  = "'", { single-quoted-key-character }, "'" ;
double-quoted-key  = '"', { double-quoted-character }, '"' ;

inline-separator   = ":", " " ;
block-separator    = ":" ;
```

For an unquoted key, the separator is the first `: `, or a colon that ends the line or the input, outside a quoted key, as specified in §5.1. A colon followed by any other character remains part of an unquoted key. For a quoted key, the separator must immediately follow the closing quote (§5.2).

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
unicode-letter     = ? a character of general category L
                       (Lu, Ll, Lt, Lm, Lo) in Unicode 18.0 ? ;
unicode-mark       = ? a character of general category M
                       (Mn, Mc, Me) in Unicode 18.0 ? ;
unicode-number     = ? a character of general category N
                       (Nd, Nl, No) in Unicode 18.0 ? ;

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
