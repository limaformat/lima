# Lima References 2.0 — Normative Specification

**Status:** Final
**Version:** 2.0.0
**Date:** 2026-08-12

This document specifies the Lima References Extension 2.0. It is a normative
addition to Lima Core 1.0 and must be read together with that specification.
It supersedes Lima References 1.0 for parsers that claim References 2.0
conformance; it does not modify Lima Core 1.0.

A Lima Core parser treats all References 2.0 tokens as ordinary string content.
A References 2.0 parser recognises only the syntax defined here. References 1.0
tokens such as `($key)` and `(%key)` are ordinary string content in References
2.0 and are not deprecated aliases.

---

## 1. Overview

References 2.0 provides two composition mechanisms:

- **Document references** — `${key}` reads a value from the current document.
- **Partial references** — `$(key)` reads a value supplied through the
  `partials` parse option.

Both forms support mapping traversal with dotted paths. A pure reference
preserves the referenced value's type; a token embedded in surrounding text is
interpolated as a string. Reference chains may contain at most three reference
edges, connecting at most four values.

The delimiters select the namespace: `${...}` reads from the document and
`$(...)` reads from the supplied partials.

---

## 2. Syntax and activity

### 2.1 Document references

```ebnf
document-reference = "${", document-path, "}" ;
document-path      = key-segment, { ".", key-segment } ;
```

Examples: `${title}`, `${site.default.claim}`, `${og:title}`,
`${_internal}`.

The first path segment names a top-level document key. Later segments traverse
nested mappings. A leading underscore has no special meaning in a document
reference.

### 2.2 Partial references

```ebnf
partial-reference = "$(", partial-name,
                    { ".", key-segment }, ")" ;
```

Examples: `$(author)`, `$(author.name)`,
`$(persons/alice.address.city)`, `$(_internal)`.

The first component names an entry in the `partials` option. `/` is literal
content in that name and permits path-like namespacing. Each component after
the first dot traverses a nested mapping. A dot is therefore not permitted in
a partial name.

### 2.3 Lexical components

```ebnf
key-segment        = reference-initial, { reference-character } ;
partial-name       = reference-initial, { partial-character } ;
reference-initial = ASCII-letter | decimal-digit | "_" ;
reference-character
                   = reference-initial | ":" | "-" ;
partial-character = reference-character | "/" ;
```

`ASCII-letter` and `decimal-digit` are defined by Lima Core Appendix D.

A colon within either form is part of the document key or partial name. Thus
`${a:b}` reads the document key `a:b`, while `$(a:b)` reads the partial named
`a:b`.

### 2.4 Active tokens

A grammatically complete token is **active** when the Core parser encounters it
while scanning:

- an unquoted inline scalar, including mapping values, sequence items, flow
  sequence items, and flow-mapping values; or
- a `|` block scalar.

A token is inactive literal content inside single- or double-quoted strings.
Keys are always literal. Implementations MUST record activity during syntactic
parsing and MUST NOT infer activity later by scanning decoded Core strings.

While scanning an active scalar, recognise the longest complete reference token
starting at the current character. Do not recognise overlapping tokens inside
an accepted token. An incomplete or grammatically invalid reference-like
substring is ordinary text and is not an unresolved-reference error.

A token's source line and character offset are its physical position in the
original source text. This includes a token on a `^^` continuation line inside
a `|` block scalar (Lima Core §6.1.6); its position MUST NOT be reconstructed
from the continuation-merged decoded string.

### 2.5 Pure references and interpolation

A value is a **pure reference** when, after the complete Core inline-value
pipeline (trim, comment removal, second trim), it consists of exactly one active
token and nothing else:

```yaml
count: ${total}
author: $(defaultAuthor)
```

A scalar is in **interpolation mode** when it contains one or more active tokens
and is not a pure reference:

```yaml
greeting: Hello ${firstName}!
credit: ${title} by $(author.name)
```

---

## 3. Lookup and value rules

### 3.1 Mapping-path traversal

For either namespace, the first component selects the root value. Each
remaining dotted component requires the current value to be a mapping and
selects the mapping entry with that exact key. Traversal through an array or
scalar, or a missing component, makes the whole reference unresolved. Numeric
components are mapping keys, never array indexes.

```yaml
site:
  default:
    claim: Software, Tools, AI
tagline: A blog about ${site.default.claim}.
```

For `$(author.address.city)`, `author` is the partial name and
`address.city` is the mapping path. Dot is always the path separator and slash
is permitted only in the partial-name component. Mapping keys containing dot
or slash therefore cannot be selected as later path segments.

### 3.2 Pure-reference result

A resolved pure reference returns the referenced Lima value with its type
preserved. The result is a structural deep copy; identity and aliasing are not
part of Lima semantics. Internal numeric-kind, source-position, active-token,
and insertion-provenance metadata MUST be preserved until resolution and final
validation finish.

If resolution fails, non-strict mode leaves the complete token unchanged as a
string. Strict mode reports an unresolved-reference error after resolution.

A pure reference resolving to an array inside another sequence produces a
nested array and is rejected by the final checks in both modes.

### 3.3 Partial values are inert

Partials are validated and copied into Lima-owned values before document
parsing. Strings originating in partials are permanently inactive. Resolution
may traverse mappings in a partial to reach a selected value, but MUST NOT
activate or resolve reference-like text stored anywhere in that partial.

```text
partials.author.name = "${defaultName}"
$(author.name)      -> "${defaultName}"  (literal)
```

### 3.4 String interpolation

In interpolation mode, every resolved token is replaced by the canonical string
representation of its result. An unresolved token remains unchanged in
non-strict mode and is reported in strict mode.

| Value | Canonical representation |
|---|---|
| string | unchanged |
| boolean | `true` or `false` |
| null | the empty string |
| integer | base-10 decimal without exponent |
| float | §3.5 |
| UTC Instant | RFC 3339 with seconds and `Z` suffix |
| array | §3.6 |
| mapping | error in both modes |

Document numbers retain their syntactic integer or float kind through
resolution. Host-provided partial numbers have no syntactic kind and always use
the float rule.

### 3.5 Canonical floats

The canonical float form is the result of ECMAScript `Number::toString` for the
corresponding finite IEEE-754 binary64 value, followed by these lexical
normalisations:

1. Replace `E` with `e`.
2. Remove a `+` immediately after `e`.
3. Remove leading exponent zeros while retaining at least one digit.

ECMAScript's fixed/exponential threshold is normative: exponents from −6
through 20 use fixed notation; all others use exponential notation. Examples:
`3.14`, `0.000001`, `1e-7`, `100000000000000000000`, `1e21`, and
`0.30000000000000004`.

### 3.6 Arrays in interpolation

Every array element must be a scalar Lima value. A nested array or mapping
element is an error in both modes. Elements are canonically serialised and
joined with `, `; an empty array becomes the empty string.

---

## 4. Transitive resolution

### 4.1 Determinism

Resolution operates on the syntactically parsed document and is independent of
mapping enumeration order and of implementation traversal order. A conforming
implementation MUST produce the same result for equivalent mappings regardless
of their host-language iteration order.

Targets may appear before or after their reference sites. Source order affects
only diagnostic ordering, never eligibility or the resolved result.

The specification does not mandate a particular algorithm. Implementations may
use dependency graphs, memoised recursion, snapshots, or another approach that
preserves the normative result. They SHOULD avoid repeatedly traversing
reference-free subtrees and SHOULD validate resource limits during expansion.

### 4.2 Reference edges and maximum chain length

A **reference edge** exists when resolving an active token requires the value
selected by that token. A chain may contain at most **three reference edges**,
connecting at most **four values**:

```text
a -> b                         1 edge
a -> b -> c                    2 edges
a -> b -> c -> d               3 edges; permitted
a -> b -> c -> d -> e          4 edges; not permitted
```

Depth is measured independently for each active source token along the longest
dependency path required to resolve it. Mapping-path components and structural
map/array nesting do not add reference edges. Multiple tokens embedded in one
interpolated scalar form separate outgoing edges; the scalar's depth is the
maximum depth required by any of them.

A partial lookup itself is one edge. Because partial contents are inert, a
partial can never introduce a further active edge.

If a token requires more than three edges, that token is unresolved. Non-strict
mode leaves it unchanged; strict mode reports it as an unresolved reference.
Implementations MAY internally distinguish depth exhaustion, but it does not
change the public error category or fallback.

The limit is evaluated at each source token, not once for the document as a
whole. Consequently, suffixes of an overlong chain may still resolve:

```yaml
a: ${b}
b: ${c}
c: ${d}
d: ${e}
e: 42
```

For `a`, the path `a -> b -> c -> d -> e` has four edges and is not permitted.
For `b`, the suffix `b -> c -> d -> e` has three edges and is permitted. The
non-strict result is therefore `a = "${b}"` and `b = c = d = e = 42`. Strict
mode reports `${b}` at `a` as unresolved. A cached target result MUST retain
enough dependency-depth information to preserve this behaviour.

The limit is a conservative complexity boundary, not a statement that longer
chains are inherently unsafe. A future backwards-compatible References minor
version may increase it.

### 4.3 Cycles

A self-reference and every token whose dependency path enters a cycle are
unresolved. This includes cycles reached through pure references or
interpolation. Non-strict mode leaves the affected tokens unchanged; strict
mode reports unresolved references in source order. A token outside a cycle
that depends on a cyclic value is also unresolved. Resolution MUST terminate;
it MUST NOT depend on reaching the chain-depth limit to detect a cycle.

### 4.4 Copies containing active tokens

Document-derived structural copies retain active-token provenance and may be
resolved transitively subject to the three-edge limit. Tokens inside a partial
remain inactive even after the partial is copied into the document.

An active token copied from a document target retains the source position of
its original spelling. The pure reference that caused the structural copy is
separately retained as insertion provenance for final-structure attribution.

---

## 5. Diagnostics and error ordering

Errors associated with source tokens are ordered by the token's 1-based line
number and then by its character offset within that line. If multiple such
errors exist, the one at the lowest source position is thrown. Messages MUST
include the complete References 2.0 token text and its source line.

This ordering applies to unresolved references (including cycles and chain
exhaustion), invalid interpolation, invalid array shapes, scalar-limit errors,
and final resource errors caused by inserted values.

For a global final-result depth, nested-array, or node-count error, attribution
goes to the earliest source token whose inserted or copied value participates
in the invalid structure. If none can be identified, report line 1.

Partial-validation errors occur before document parsing and take precedence.
They identify the partial name and value path and carry no document line.

---

## 6. API and partial validation

### 6.1 Parse functions

```text
parse(input: string, options?: ParseOptions): Record<string, unknown>
```

`parse` is the primary References 2.0 entry point. By default it performs Lima
Core parsing followed by reference resolution as specified here. Its return
contract is identical to `parseCore` in Lima Core §11.1.

`parseCore(input, options?)` remains the explicit Core-only entry point defined
by Lima Core 1.0. A call to `parse(input, { mode: "core" })` is
semantically identical to `parseCore(input, options)` with the shared Core
options: References 2.0 tokens remain literal, no partials are ingested, and no
reference-resolution work is performed.

Core mode MUST use the same reference-unaware parsing path as `parseCore`. It
MUST NOT perform reference-token recognition, active-token metadata collection,
partial ingestion, dependency analysis, or reference resolution. Dispatching
on `mode` before any References-specific work is therefore required; internal
implementation details of the shared Core path remain unrestricted.

Bindings that exposed `parseReferences` before 2.0 SHOULD retain it as a
deprecated compatibility alias for `parse` during the 2.x release line. The
alias MUST have exactly the same options, result, diagnostics, and References
2.0 semantics as `parse`; it is not a References 1.0 compatibility mode. New
code SHOULD use `parse`.

Names may follow host-language conventions (`parse_core`, `Parse`, etc.), but
the roles of the primary, Core-only, and deprecated compatibility entry points
are normative.

`ParseOptions` extends Core options with:

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"references" \| "core"` | `"references"` | Select full References 2.0 parsing or Core-only parsing |
| `partials` | `Record<string, unknown>` | `{}` | Values available through `$(name)` |

`partials` MUST NOT be supplied when `mode` is `"core"`. Such a call is
outside the parse contract and MUST be rejected before document parsing; the
concrete host-language argument-error type is binding-specific. It is never a
document diagnostic and carries no source position.

Bindings represent an omitted mode according to host-language conventions. In
particular, a binding MUST NOT require a boolean whose zero value conflicts
with the normative `"references"` default; an enum, string union, or optional
mode value is appropriate.

### 6.2 Partial validation

All partial values are validated and structurally copied before document
parsing. Failure identifies the partial and value path. The original host
objects are not used after validation.

An invalid partial name is reported before its value is inspected. That error
identifies the partial name but has no value path, because no value traversal
has begun.

| Resource | Limit |
|---|---:|
| Partial names | 128 |
| Partial-name length | 128 Unicode code points |
| Total nodes across all partials | 4,096 |
| Mapping-key length | 128 Unicode code points |

Partial names MUST match `partial-name` from §2.3; in particular, they contain
no dot. Names beginning with `_` are valid.

```text
nodeCount(scalar)  = 1
nodeCount(array)   = 1 + sum(nodeCount(element))
nodeCount(mapping) = 1 + sum(nodeCount(value))
```

Mapping keys are not separate nodes. Empty arrays and mappings each count as
one node.

The partial value model is:

```text
LimaValue = null | boolean | finite binary64 number
          | string | UTC Instant | LimaValue[]
          | string-keyed mapping of LimaValue
```

The following constraints apply:

- strings contain at most 16,384 Unicode code points;
- arrays may not directly contain arrays;
- combined map/array depth is at most 16;
- cyclic host values are invalid;
- numbers are finite; negative zero becomes positive zero;
- UTC Instants have years 0001–9999 and milliseconds truncated to zero;
- mappings are plain string-keyed objects with own enumerable data properties;
- class instances, accessors, functions, symbols, and other host types are
  invalid; and
- validated mappings are prototype-free.

### 6.3 Final-result validation

After resolution and copying, the complete result is checked in both modes.
Resource limits are:

| Resource | Limit |
|---|---:|
| String length | 16,384 Unicode code points |
| Combined map/array depth | 16 |
| Total result nodes | 65,536 |

Exceeding a limit is a hard error in strict and non-strict mode.

Separately, a direct nested array in the final result is an invalid reference
shape, not a resource-limit violation. It throws `INVALID_REFERENCE_SHAPE` in
both modes.

---

## 7. Mode behaviour

| Condition | Non-strict | Strict |
|---|---|---|
| Missing or invalid lookup path | leave token | throw unresolved-reference error |
| Dependency cycle | leave token | throw unresolved-reference error |
| More than three reference edges | leave token | throw unresolved-reference error |
| Mapping interpolated into string | throw | throw |
| Invalid array interpolation | throw | throw |
| Nested array produced by insertion | throw | throw |
| Final resource limit exceeded | throw | throw |
| Invalid partial input | throw before parsing | throw before parsing |

Inactive tokens, including tokens inside quoted strings and old References 1.0
tokens, never produce unresolved-reference errors.

---

## 8. Unsupported constructs

| Construct | Rule |
|---|---|
| References 1.0 `($key)` / `(%key)` | literal text; no compatibility aliases |
| Briefly published 2.0 `$(:key)` syntax | literal text; no compatibility alias |
| Briefly published 2.0 `$(key)` document syntax | parsed as a partial reference |
| More than three reference edges | unresolved |
| References inside quoted strings | literal |
| References in mapping keys | literal |
| Array-index traversal | unsupported |
| Dots inside partial names | invalid partial name |
| Evaluation of reference-like partial strings | never performed |
| Mapping interpolation | error |
| Array spreading | unsupported |
| Object identity or aliasing | not part of Lima semantics |

---

## 9. Consolidated normative grammar

```ebnf
reference-token    = document-reference | partial-reference ;

document-reference = "${", document-path, "}" ;
partial-reference  = "$(", partial-name,
                     { ".", key-segment }, ")" ;

document-path      = key-segment, { ".", key-segment } ;
key-segment        = reference-initial, { reference-character } ;
partial-name       = reference-initial, { partial-character } ;

reference-initial = ASCII-letter | decimal-digit | "_" ;
reference-character
                   = reference-initial | ":" | "-" ;
partial-character = reference-character | "/" ;
```

Procedural activity, longest-match scanning, pure-reference classification,
transitive resolution, diagnostics, and resource validation remain governed by
§§2–7. If the grammar and procedural rules appear to conflict, the procedural
rules are authoritative.

---

## 10. Compatibility summary

References 2.0 is intentionally not syntax-compatible with References 1.0:

| References 1.0 | References 2.0 |
|---|---|
| `($site.title)` | `${site.title}` |
| `(%author)` | `$(author)` |
| partials are direct-only | partial mappings support dotted traversal |
| unused partial names may be outside token grammar | every partial name must match `partial-name` |
| one-hop snapshot model | transitive resolution, maximum three edges |
| `parseReferences` is primary | `parse` is primary; `parseReferences` is a deprecated alias |

Lima Core 1.0 semantics and APIs are unchanged.
