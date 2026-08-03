# Lima References 1.0 — Normative Specification

**Status:** Release Candidate  
**Version:** 1.0.0  
**Date:** 2026-07-31

This document specifies the Lima References Extension. It is a normative addition to Lima Core 1.0 and must be read in conjunction with that document.

A Lima References conforming parser implements all of Lima Core 1.0 plus the rules defined here. A Lima Core conforming parser that does not implement this extension treats `($key)` and `(%key)` tokens as plain strings — this is explicitly valid behaviour.

---

## 1. Overview

The References Extension adds two lightweight composition mechanisms to Lima Core:

- **Document references** `($key)` — reference a value defined elsewhere in the same document
- **Partial references** `(%key)` — reference a value provided by the host application

The `$` character is the **document sigil**: it indicates that the reference resolves against the parsed document. The `%` character is the **partial sigil**: it indicates that the reference resolves against the host-provided `partials` map. Both sigils are only meaningful to a Lima References conforming parser; a Lima Core parser treats the entire `($...)` or `(%...)` token as a plain string.

References can be used in two modes:

- **Pure reference** — the entire value is a single reference token; the referenced value is returned as-is, preserving its original type
- **String interpolation** — one or more reference tokens are embedded in surrounding text; the result is always a string

References are resolved in two phases after syntactic parsing is complete (see §4).

---

## 2. Syntax

### 2.1 Document Reference

```
doc-ref     = "($" path ")"
path        = key-segment ("." key-segment)*
key-segment = [a-zA-Z0-9_][a-zA-Z0-9_:\-]*
```

Examples: `($title)`, `($site.default.claim)`, `($og:title)`

### 2.2 Partial Reference

```
partial-ref = "(%" partial-key ")"
partial-key = [a-zA-Z0-9_][a-zA-Z0-9_:\-\/]*
```

The partial key may contain forward slashes (`/`) to allow path-like namespacing: `(%persons/alice)`. Forward slashes are literal characters in the key name, not path separators for traversal.

Examples: `(%defaultAuthor)`, `(%persons/alice)`

### 2.3 Active Reference Tokens

Reference recognition occurs during syntactic (Core) parsing, not during resolution. A reference token is **active** when it appears in:

- An unquoted inline scalar — this includes top-level and nested mapping values, block-sequence items, flow-sequence items, and flow-mapping values
- A block scalar (`|` block)

A reference token is **inactive** (literal string content) when it appears in:

- A single-quoted string
- A double-quoted string

This distinction must be preserved internally between the syntactic parse and the resolution phases. Implementations must track which string values contain active reference tokens — the resolution phases must not rediscover reference-like substrings by scanning final Core string values. This internal representation need not be part of the public API.

### 2.4 Pure Reference

A value is a **pure reference** when the entire scalar value — after the complete inline value processing pipeline defined in Core §4 (trimming, comment stripping, second trim) — consists of exactly one active `($...)` or `(%...)` token and nothing else.

```yaml
count: ($total)          # pure reference → preserves type of 'total'
author: (%defaultAuthor) # pure reference → preserves type of partial
title: "($key)"          # NOT a reference — double-quoted, inactive token
```

### 2.5 String Interpolation

A value is in **string interpolation mode** when it contains one or more active reference tokens embedded in surrounding text, or more than one active reference token.

```yaml
greeting: Hello ($firstName)!          # interpolation → always a string
fullName: ($firstName) ($lastName)     # two tokens → interpolation → string
label: ($title) by (%author)           # mixed → interpolation → string
```

```yaml
description: |
  Written by ($author).                # block scalar → interpolation active
```

The distinction between pure reference and interpolation is determined by whether the value contains anything other than a single active reference token (after trimming).

---

## 3. Resolution Rules

### 3.1 Pure Reference

A pure reference returns the referenced value as-is, preserving its original type. The result is a structural deep copy — object identity and aliasing are not part of Lima semantics:

```yaml
total: 42
count: ($total)    # → 42 (number, not string)

tags: [a, b]
copy: ($tags)      # → ['a', 'b'] (deep copy)

published: 2024-03-01
date: ($published) # → UTC Instant
```

If the referenced value is `null`, the result is `null`.

If the reference cannot be resolved, the token is left unchanged as a string in non-strict mode. In strict mode, throw after the second phase (see §4). Unresolved token error messages must include the token text and its source line number.

If a pure reference resolves to an array and is inserted as an element of another sequence (e.g. `tags: [($base)]` where `base: [a, b]`), this produces a nested array. The post-resolution check (§6.2) will catch and reject this in both modes.

Structural deep copies preserve all internal resolution metadata — including syntactic numeric kind (integer or float), active-token provenance, and source position information — until reference resolution and final validation are complete. This applies to numbers contained in copied arrays and mappings. All internal metadata is discarded before the public result is returned.

### 3.2 String Interpolation

In string interpolation mode, each active reference token is replaced by its canonical string representation (see §3.5).

If a reference cannot be resolved in interpolation mode, the token is left unchanged in the output string in non-strict mode. In strict mode, throw after the second phase.

### 3.3 Dotted Path Resolution

A dotted path `($a.b.c)` traverses nested mappings:

```yaml
site:
  default:
    claim: Software, Tools, AI
tagline: Ein Blog über ($site.default.claim).
```

Traversal rules:
- Each segment must resolve to a mapping to allow further traversal.
- If any intermediate segment is missing, `null`, or not a mapping, the entire path is unresolved.
- Unresolved dotted path: leave token unchanged in non-strict; throw in strict (after second phase).

Dotted paths are not supported for partial references — `(%a.b)` is not valid. Use slash notation in the partial key name: `(%a/b)`.

### 3.4 Partial Resolution

A partial reference `(%key)` resolves against the validated `partials` map (see §6.2). The key is looked up directly — no dotted path traversal. Forward slashes in the key are literal characters.

Partials are validated and deep-copied into Lima-owned values before use (see §6.2). The resolution result is always a Lima value — no host-language types can appear in the output via partials.

If the partial key is not found, the token is left unchanged in non-strict mode. In strict mode, throw after the second phase.

### 3.5 Canonical String Representation

When a value is used in string interpolation, it is converted to a string using the following canonical rules. These rules are implementation-language-agnostic and must produce identical output across all conforming implementations.

| Value type | Canonical string representation |
|------------|--------------------------------|
| `string` | the string itself, unchanged |
| `boolean` | `"true"` or `"false"` |
| `null` | empty string `""` — the token is replaced with nothing |
| integer | base-10 decimal, no leading sign for positive values, no exponent: `42`, `-1`, `0` |
| float | see §3.5.1 |
| UTC Instant | RFC 3339 string with seconds and Z suffix: `2024-03-01T09:00:00Z` |
| Array | see §3.6 |
| Mapping | throw in both modes — mappings cannot be interpolated into strings |

**Numeric kind for interpolation:** A parsed document numeric value retains its syntactic kind — integer or float — as internal metadata until reference resolution is complete. This metadata is not part of the public Core result, but the References Extension uses it to select the correct serialisation rule. A value parsed from `1000` serialises as integer (`"1000"`); a value parsed from `1000.0` or `1e3` serialises as float (also `"1000"` after ECMAScript canonicalisation, but via the float rule).

Host-provided partial numbers have no syntactic kind. They are always serialised using the canonical float rule (§3.5.1), regardless of whether their mathematical value is integral. Therefore `partials: { n: 1e21 }` serialises as `"1e21"`, and `partials: { n: 1000 }` serialises as `"1000"`.

#### 3.5.1 Canonical Float Serialisation

The canonical string form of a float is defined as the result of the **ECMAScript `Number::toString` algorithm** for the corresponding finite IEEE-754 binary64 value, followed by these purely lexical normalisations:

1. Replace any uppercase `E` with lowercase `e`.
2. Remove any `+` sign immediately following `e`: `e+21` → `e21`.
3. Remove any leading zeros from the exponent, retaining at least one digit: `e07` → `e7`, `e-07` → `e-7`.

The ECMAScript algorithm is the normative definition — it determines both the digit sequence and the choice between fixed and exponential notation. An implementation MAY use an internal conversion algorithm such as Ryu, Dragonbox, or Grisu, but it MUST apply ECMAScript's fixed-versus-exponential formatting thresholds and produce exactly the same result as `Number::toString` before the lexical normalisations above.

**Fixed vs. exponential threshold (from ECMAScript):**
- If the exponent is in the range −6 to 20 (inclusive), fixed notation is used.
- Otherwise, exponential notation is used.

**Normative examples:**

| Float value | Canonical string | Notes |
|-------------|-----------------|-------|
| `3.14` | `"3.14"` | fixed |
| `-0.5` | `"-0.5"` | fixed |
| `0.000001` | `"0.000001"` | fixed (exponent −6) |
| `1e-7` | `"1e-7"` | exponential (exponent −7) |
| `1e20` | `"100000000000000000000"` | fixed (exponent 20) |
| `1e21` | `"1e21"` | exponential (exponent 21) |
| `0.30000000000000004` | `"0.30000000000000004"` | fixed |
| `1000.0` | `"1000"` | fixed, no decimal point |

These examples are normative. Implementations that produce different output for these values are non-conforming.

### 3.6 Array Interpolation Rules

When an array is used in string interpolation:

- Each element must be a scalar Lima value (string, boolean, number, null, UTC Instant). Arrays containing nested arrays or mappings as elements throw in both modes.
- Each element is serialised using the canonical string representation from §3.5.
- Elements are joined with `", "` (comma followed by a single space).
- An empty array produces an empty string `""`.

### 3.7 One-Hop Limit

A reference is resolved only if its target was reference-free at the start of the current resolution phase. Chains are not resolved:

```yaml
a: ($b)
b: ($c)
c: 42
```

Resolution trace:
- **Phase 1:** `c = 42` (reference-free). `b` contains active token `($c)` — cannot be a target yet. `a` contains active token `($b)` — cannot be a target yet. After phase 1: `a = '($b)'`, `b = '($c)'`, `c = 42`.
- **Phase 2 snapshot:** `c` is reference-free (42). `b` still contains active token `($c)` — not reference-free in this snapshot. Therefore: `b` resolves to 42 (its target `c` is reference-free). `a` cannot resolve because its target `b` was not reference-free in the phase-2 snapshot.
- **Final result:** `a = '($b)'`, `b = 42`, `c = 42`.

In strict mode, `a` is reported as unresolved after phase 2.

**Important:** The one-hop limit is a known usability constraint. Authors who create reference chains (`a → b → c`) will receive unresolved token strings in non-strict mode. This is intentional — Lima is a data format, not an evaluation system. This behaviour should be prominently documented in the README.

### 3.8 No Traversal into Partial Values

The resolution phases never traverse into values originating from partials. Reference-like strings inside partial values are always literal — they are Lima string values, not active reference tokens.

```yaml
# partials = { author: { name: "($defaultName)" } }
person: (%author)
# → { name: '($defaultName)' }  — NOT resolved further
```

This follows from the one-hop philosophy and prevents mutation of the validated partial copy.

---

## 4. Resolution Phases

References are resolved in two phases after syntactic (Core) parsing is complete. Both phases operate on **snapshots**: each phase reads from an immutable view of the document values as they existed at the start of that phase. A reference is resolved only if its target was reference-free before the current phase began. Results of the current phase are not used as resolution targets within the same phase. This guarantees that the output is independent of mapping enumeration order.

### 4.1 Phase 1 (Backward References)

The first phase iterates over all parsed values and resolves any active reference tokens whose targets are already reference-free.

For **document references**: a target is considered earlier than a reference when the target's defining key begins at a lower source position (ordered by 1-based line number, then character offset within the line) than the reference token. Only document targets at earlier source positions — and containing no active tokens — are eligible for resolution in phase 1. For a dotted path, the defining key is the key of the final path segment (the key that holds the target value directly), not the top-level root key. Implementations must track the source position of every key in the document at all nesting levels, not only top-level keys, in order to apply this rule correctly to dotted paths.

For **partial references**: validated partial values have no document source position. They are always considered available and reference-free before every document source position. Therefore all partial references are eligible for resolution in phase 1, regardless of where in the document they appear.

Forward references — references to keys appearing later in the document — remain as active tokens after phase 1.

### 4.2 Phase 2 (Forward References)

After phase 1, a second phase iterates over all values and attempts to resolve any remaining active reference tokens. The snapshot is taken from the phase-1 output. A token is resolved only if its target is reference-free in this snapshot.

The second phase recurses into arrays and nested mappings of document values. It does not recurse into values originating from partials (see §3.8).

### 4.3 Self-References and Cycles

A self-reference (`a: ($a)`) is unresolvable — at the start of both phases, the key's value is itself an active token. After both phases it remains as the string `'($a)'`. In strict mode, this is reported as unresolved.

A two-key cycle (`a: ($b)`, `b: ($a)`) is handled by the snapshot rule: at the start of phase 2, both values are still active tokens, so neither can serve as a resolution target for the other. Both remain as token strings in non-strict mode; strict mode reports the first unresolved token by source position (see §5).

No explicit cycle detection is required. The snapshot-based two-phase model naturally terminates without risk of infinite loops.

---

## 5. Error Ordering

All reference-resolution errors associated with source tokens are collected and ordered by source position. Source position is ordered first by 1-based line number, then by character offset within the line. The error at the lowest source position is thrown. This ordering applies to all error types: unresolved references, mapping-in-interpolation, invalid array elements, scalar-limit violations, nesting-depth violations, nested-array violations, and total-result-node-count violations caused by reference resolution.

For global final-result resource errors (nesting depth, nested arrays, total node count): the error is attributed to the lowest source position among the resolved reference tokens whose inserted or copied values participate in the invalid final structure. The error message includes that token text and source line number. If no source token can be identified as a participant, the error reports line 1.

Partial-validation errors (§6.2) occur before document parsing and therefore take precedence over all source-position-ordered errors. They must identify the failing partial key and the value path within the partial — they do not carry a document source line number.

---

## 6. API

### 6.1 References Parse Function

```
parseReferences(input: string, options?: ReferencesParseOptions): Record<string, unknown>
```

Identical contract to `parseCore` (Core spec §11.1) with the addition of reference resolution as specified in §3–§4.

### 6.2 ReferencesParseOptions and Partial Validation

`ReferencesParseOptions` extends `CoreParseOptions` (Core spec §11.2) with:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `partials` | `Record<string, unknown>` | `{}` | Named values for `(%key)` references |

**Partial validation:** Before document parsing begins, all values in the `partials` map are validated against the Lima Value Model and deep-copied into Lima-owned prototype-free structures. The original host objects are not used after this point. If any partial value fails validation, `parseReferences` throws immediately. The error must identify the failing partial key and the value path (e.g. `"navigation" at navigation.items[2].url: unsupported value type`). Partial-validation errors do not carry a document source line number.

**Partial resource limits:**

| Resource | Limit |
|----------|-------|
| Number of partial names | 128 |
| Partial name length | 128 Unicode code points |
| Total value nodes across all partials | 4,096 |
| Mapping key length within partials | 128 Unicode code points |

A **value node** is counted as follows:

```
nodeCount(scalar)  = 1
nodeCount(array)   = 1 + sum(nodeCount(element) for each element)
nodeCount(mapping) = 1 + sum(nodeCount(value) for each entry)
```

Mapping keys do not count as separate nodes (key length is bounded by the 128 Unicode code point limit). An empty array or empty mapping counts as 1 node. Exceeding any limit throws during partial validation, before parsing begins.

**Lima Value Model for partials:**

```
LimaValue =
  null
  | boolean
  | finite IEEE-754 binary64 number (no NaN, no Infinity; negative zero normalised to positive zero)
  | string (max 16,384 Unicode code points)
  | UTC Instant (valid Date instance in JS; UTC year 0001–9999; milliseconds truncated to zero)
  | LimaValue[]  (no nested arrays; max 16 nesting levels combined with mappings)
  | string-keyed prototype-free mapping of LimaValue
      (keys: arbitrary strings up to 128 Unicode code points, including empty string;
       copied as own data keys into prototype-free maps)
```

Additional constraints:
- No cyclic references in partial values.
- No host-language types (functions, class instances, symbols, accessor properties, etc.).
- **Numbers:** Host-provided numbers must be finite IEEE-754 binary64 values. The Core safe-integer restriction (−(2^53−1) to 2^53−1) applies only to integer literals parsed from document text, not to host-provided numeric values. A finite `1e20` partial is therefore valid. Negative zero is normalised to positive zero. `NaN` and `Infinity` are invalid.
- UTC Instant: for JavaScript, a valid `Date` instance representing a finite instant. Milliseconds are truncated (not rounded) to zero. The resulting UTC year must fall within 0001–9999. An invalid `Date` (NaN) or a `Date` outside this range throws.
- Mapping keys may be empty strings (consistent with Core quoted key rules).
- A host mapping input must be a plain string-keyed object containing only own enumerable data properties. It is deep-copied into a prototype-free Lima mapping. Class instances, accessor properties, and non-string keys are invalid. Ordinary `{}` objects are valid inputs.

**Resource limits after resolution:** After all reference resolution and structural copying, the entire final result tree is checked for the following limits:

- **Scalar length:** any string value (including strings produced by interpolation) must not exceed 16,384 Unicode code points. If exceeded, throw in both modes.
- **Nesting depth:** the combined nesting depth of maps and arrays in the final result must not exceed 16 levels. This applies to values inserted via both document references and partial references. If exceeded, throw in both modes.
- **Total result nodes:** the total node count of the final result tree (using the same `nodeCount` definition as partial validation) must not exceed 65,536. This prevents unbounded growth through repeated deep copies of large partial values (e.g. 128 top-level keys each referencing the same 4,096-node partial). If exceeded, throw in both modes.
- **Nested arrays:** the final result must not contain an array whose direct element is itself an array. Reference insertion (both document and partial references) that would produce a nested array throws in both modes. This preserves the Core constraint that Lima sequences contain only scalars or mappings, not other sequences.

---

## 7. Strict Mode Additions

The References Extension adds the following entries to the Core strict error list (Core spec §10.1). For the complete normative definition of the References Extension — including syntax, resolution phases, resource checks, and API additions — this document is authoritative. The Core spec Appendix B provides only a summary for orientation.

| Condition | Non-strict | Strict |
|-----------|-----------|--------|
| Unresolved reference after both phases | leave token as string | throw |
| Mapping value used in string interpolation | throw | throw |
| Array element is a mapping or nested array (in interpolation) | throw | throw |
| Nested array produced by reference insertion | throw | throw |
| Scalar limit exceeded after interpolation or copying | throw | throw |
| Nesting depth exceeded after reference insertion | throw | throw |
| Total result node count exceeds 65,536 | throw | throw |
| Invalid partial value (fails Lima Value Model or resource limits) | throw | throw |

Mapping-in-interpolation, invalid array elements, and invalid partial values throw in both modes because there is no meaningful or implementation-agnostic fallback.

All errors from the References Extension that are associated with source tokens MUST include the token text and the 1-based source line number. Partial-validation errors identify the partial key and value path instead.

Quoted strings containing reference-like tokens (e.g. `"($missing)"`) are inactive and must not trigger unresolved-reference errors in either mode.

---

## 8. Appendix — What the References Extension Does Not Support

| Construct | Reason |
|-----------|--------|
| Transitive references (`a → b → c`) | Lima is a data format, not an evaluation system |
| Explicit cycle detection | Snapshot-based two-phase model makes it unnecessary |
| `%key` shorthand without parentheses | Removed; `(%key)` is the only partial syntax |
| Dotted paths in partial references `(%a.b)` | Partials are flat; use slash notation `(%a/b)` as key name |
| References inside quoted strings | Quoted strings are always literal; tokens are inactive |
| References in key names | Keys are always literal |
| References in flow mapping keys | Keys in flow mappings are always literal |
| Host-language types in partials | All partials validated against Lima Value Model |
| Object identity / aliasing | Pure references produce structural deep copies |
| Mappings in string interpolation | Throw in both modes |
| Nested arrays in string interpolation | Throw in both modes |
| Traversal into partial values during resolution | One-hop philosophy; partial strings are always literal |
| Array spreading of partial values | Removed — same value must behave identically regardless of insertion context; host should flatten arrays before passing as partials |
| Nested array produced by reference insertion | Core constraint: sequences contain scalars or mappings only |

---

## 9. Appendix B — Normative Reference Grammar

### 9.1 Scope and Precedence

This appendix consolidates the lexical grammar of active reference tokens. It supplements Lima Core Appendix D and the resolution rules in §§2–4.

The grammar determines whether a substring has the shape of a document or partial reference. Token activity, pure-reference classification, interpolation, snapshots, one-hop resolution, errors, and resource checks remain governed by the procedural rules in the main specification. If this appendix and those rules appear to conflict, the procedural rules are authoritative.

### 9.2 Reference Tokens

```ebnf
reference-token    = document-reference | partial-reference ;

document-reference
                  = "($", document-path, ")" ;

document-path     = key-segment, { ".", key-segment } ;

partial-reference = "(%", partial-key, ")" ;

key-segment       = reference-initial, { reference-character } ;
partial-key       = reference-initial, { partial-character } ;

reference-initial = ASCII-letter | decimal-digit | "_" ;
reference-character
                  = reference-initial | ":" | "-" ;
partial-character = reference-character | "/" ;
```

`ASCII-letter` and `decimal-digit` are defined in Lima Core Appendix D §15.10.

A dot is a path separator only in `document-path`. It is not permitted inside a `key-segment`. A slash is literal content in a `partial-key`; it does not introduce traversal.

### 9.3 Active-Token Context

The following contextual rule is not expressible as a standalone context-free production and is therefore stated procedurally:

```text
A reference-token is active only when the Core parser encounters it while
scanning an unquoted inline scalar or a | block scalar. The same character
sequence inside a single- or double-quoted string is literal content.
```

Implementations must record active tokens during Core parsing. They must not reconstruct activity by scanning the final decoded string value (§2.3).

### 9.4 Pure Reference and Interpolation Classification

After the complete Core inline-value pipeline has run:

```ebnf
pure-reference-value
                  = reference-token ;

interpolated-value
                  = ? an active scalar containing at least one
                       reference-token and not consisting of exactly one
                       reference-token ? ;
```

The classification is based on active-token provenance, not merely on matching characters in the final string.

### 9.5 Scanner Integration

While scanning an active scalar, implementations use the following precedence:

1. Recognise the longest complete `document-reference` or `partial-reference` beginning at the current character.
2. If no complete production matches, treat the current character as ordinary scalar content.
3. Do not recognise overlapping tokens inside a token already accepted by step 1.

An incomplete or grammatically invalid reference-like substring is ordinary string content. In strict mode it is not an unresolved-reference error because no active reference token was recognised.
