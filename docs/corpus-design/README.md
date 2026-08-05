# Lima Conformance Corpus – Design Package

**Status:** implemented — 250 cases, count pinned by a test
(`corpus/runner/test/loader.test.ts`), verified with `bun run run` from
`corpus/runner/`. This document is the design rationale the corpus was
built from; §11's "Implementation order" is a historical record of how
that happened, not an open plan. Where this document and the actual
corpus disagree, the corpus and its passing tests are authoritative — file
an issue rather than trusting stale prose here.
**Normative basis:** Lima Core 1.0 and Lima References 1.0
**First implementation:** TypeScript/Bun (`@limaformat/lima`)
**Long-term goal:** the same corpus validates TypeScript, Rust, and further implementations

## 1. Required architecture

As a rule, every hand-written test consists of two sidecar files:

```text
case-name.lima   # exact parser input
case-name.json   # metadata, options, and expectation
```

Exceptions:

- Generator cases may have only a `.json` description.
- Host values that JSON cannot natively express are represented via typed
  corpus values.
- Byte-exact special cases may use a `.bin` file or a specially generated
  input; the generator is then part of the case description.

## 2. Why `.lima` plus JSON?

The Lima input stays verbatim and readable. JSON describes only the test
contract and introduces no YAML-native type semantics.

The corpus is not described in YAML, because:

- YAML itself types values,
- parser dialects can diverge,
- Lima edge cases would need to be re-quoted,
- corpus loading errors could be mistaken for Lima errors.

The corpus is not fully described in Lima either, because that would be
circular: the parser under test would simultaneously load its own test
definitions.

## 3. File names and IDs

File name:

```text
<short-kebab-case-name>.lima
<short-kebab-case-name>.json
```

Case ID:

```text
core.<area>.<rule>.<variant>
references.<area>.<rule>.<variant>
```

Examples:

```text
core.numbers.safe-integer.maximum
core.strings.unknown-escape.strict
references.phases.forward-reference.phase-2
references.interpolation.float.exponent-threshold
```

IDs are permanently stable. Renaming an ID is a corpus change.

## 4. Case kinds and defaults

A case has exactly one expectation kind:

- `result`: successful parse
- `error`: a thrown error
- `warnings` (optional, alongside `result`): warnings from a successful parse

Strict/non-strict differences are preferably modeled as separate cases, so
that every case stays atomic and easy to run.

For readability, these defaults apply:

```text
strict = false
partials = {}
warnings = []
api = "references"
```

Default values should not be spelled out in sidecars.

`api` selects the entry point a case runs against: the default
`"references"` calls `parseReferences`/`parse`; `"core"` calls `parseCore`
directly, with no partials option (Core has none — a case may not combine
`api: "core"` with `options.partials`). Only needed to exercise Core-only
behavior directly, e.g. proving `parseCore` never resolves references even
though the same input would resolve (or throw) under `parseReferences`.

## 5. Language-neutral values

Ordinary values are represented directly in JSON.

UTC instant:

```json
{
  "$type": "instant",
  "value": "2024-03-01T09:00:00Z"
}
```

Special host values for partial validation:

```json
{ "$type": "host-number", "value": "nan" }
{ "$type": "host-number", "value": "infinity" }
{ "$type": "host-number", "value": "-0" }
{ "$type": "host-date", "value": "invalid" }
{ "$type": "host-date", "value": "year-underflow" }
{ "$type": "host-date", "value": "year-overflow" }
```

`host-date` uses a fixed sentinel set — not an arbitrary date string —
deliberately, for the same reason as `host-number`: an arbitrary string
handed to each runner's native date parser (e.g. JavaScript `Date`, a Rust
date crate) is not guaranteed to parse identically across runners, so it
cannot serve as a reproducible cross-language test input. `invalid`
materializes to an invalid date (`NaN` timestamp in JS); `year-underflow`
and `year-overflow` materialize to a valid date one year outside the
References §6.2 UTC year range (0001–9999) — UTC year `0000` and `10000`
respectively, constructed numerically rather than via string parsing to
sidestep host-language date quirks (e.g. JS's two-digit-year mapping).

These markers are corpus representations, not Lima values. Each runner
materializes the matching host representation from them.

## 6. Diagnostic model

Lima exposes a small, public, structured error API. The corpus compares
semantic fields instead of full English message text.

```json
{
  "code": "UNRESOLVED_REFERENCE",
  "line": 2,
  "column": 8,
  "token": "($missing)"
}
```

Possible fields:

- `code`: stable public Lima error or warning code
- `line`: 1-based line
- `column`: 1-based character offset, where normatively required
- `token`: reference token
- `key`: affected mapping key
- `partial`: partial name
- `path`: value path within a partial
- `contains`: optional message excerpt

There is no second, permanent corpus classification.

## 7. Warnings

Warnings use the same diagnostic core:

```json
{
  "warnings": [
    {
      "code": "DUPLICATE_KEY",
      "line": 2,
      "key": "title"
    }
  ]
}
```

There must be no implicit console output as a substitute for `onWarning`.

## 8. Mapping comparison

Mapping order is not significant. Runners therefore compare mappings
order-independently. Sequences remain order-sensitive.

For JavaScript, result mappings should additionally be checked for safe,
own data properties; the concrete prototype check is a binding check, not
a language-neutral value comparison.

## 9. Generator cases

Boundary values are preferably generated:

```json
{
  "generator": {
    "name": "repeated-scalar",
    "parameters": {
      "codePoint": "x",
      "length": 16385
    }
  }
}
```

Every generator must be deterministic, documented, and reproducible across
runners. Generator semantics are part of the corpus contract.

### 9.1 First-stage generator parameter contracts

Implemented in `corpus/runner/src/generators/`, confirmed as the authoritative
parameter contract:

- **`repeated-scalar`** — `key` (string), `codePoint` (string, repeated
  as-is), `length` (positive integer). Produces `${key}: ${codePoint.repeat(length)}`.
  Tests the scalar-length boundary (Core §9).
- **`document-bytes`** — `length` (positive integer, total UTF-8 bytes
  including line separators), optional `fillCodePoint` (default `"x"`).
  Produces as many `kN: ...` top-level keys as needed to hit `length`
  exactly, keeping every individual scalar far under the scalar-length
  limit — a single giant scalar would trip that limit before reaching the
  document-size boundary this generator exists to test (Core §9).
- **`nested-mappings`** — `depth` (non-negative integer, matches Core §9's
  own recursive `depth()` definition exactly), optional `key` (default
  `"k"`), optional `leafValue` (default `"v"`). `depth: 0` produces a flat
  `k: v`; `depth: 16` produces the maximum permitted nesting.
- **`repeated-key`** — `count` (positive integer), optional `keyPrefix`
  (default `"k"`), optional `value` (default `"v"`). Produces `count`
  *distinct* top-level keys (`k0`, `k1`, ...) — not a duplicated key;
  duplicate-key handling has its own dedicated hand-written cases. Tests
  the top-level-entry-count boundary (Core §9).

These four only ever produce the `.lima` input text. The three generators
below also produce a `partials` map — a partial-limit boundary (e.g. a
4,096-node partial) is exactly the kind of value a generator exists to
avoid writing out by hand. A generator's return value is therefore either
a plain string (input only, the four above) or `{ input, partials }`.

- **`partial-count`** — `count` (positive integer), optional `namePrefix`
  (default `"p"`). Produces `count` distinct partial names (`p0`, `p1`,
  ...), each a trivial scalar value, and an empty document (partial
  validation happens before document parsing — References §6.2 — so the
  document itself does not need to reference them). Tests the
  partial-name-count boundary (References §6.2, max 128).
- **`partial-node-tree`** — `totalNodes` (positive integer), optional
  `partialName` (default `"big"`). Produces one partial whose node count
  (the References §6.2 `nodeCount` formula) is exactly `totalNodes`, as an
  array of `totalNodes - 1` scalar elements. Tests the total-partial-node
  boundary (References §6.2, max 4,096 across all partials).
- **`result-node-expansion`** — `topLevelKeys` (positive integer),
  `partialNodes` (positive integer), optional `keyPrefix` (default `"k"`),
  optional `partialName` (default `"big"`). Produces `topLevelKeys`
  top-level keys, each a pure reference to the same `partialNodes`-node
  partial. Since a pure reference is a structural deep copy (References
  §3.1), each reference multiplies the final result's node count
  independently — this is the "128 top-level keys each referencing the
  same 4,096-node partial" scenario from §6. Tests the total-result-node
  boundary (References §6.2, max 65,536).

## 10. Small public error API

Lima uses a single error class plus a shared diagnostic core (implemented
in `js/src/errors.ts`, matching this design exactly — see also
[`error-api.md`](error-api.md) for the current export status):

```ts
export type LimaDiagnosticCode =
  | "INVALID_ESCAPE"
  | "INVALID_QUOTE"
  | "INVALID_DATE"
  | "INVALID_NUMBER"
  | "INVALID_REFERENCE_SHAPE"
  | "INVALID_INDENTATION"
  | "INVALID_FLOW_SYNTAX"
  | "DUPLICATE_KEY"
  | "RESOURCE_LIMIT"
  | "UNRESOLVED_REFERENCE"
  | "INVALID_INTERPOLATION"
  | "INVALID_PARTIAL";

export interface LimaDiagnostic {
  code: LimaDiagnosticCode;
  message: string;
  line?: number;
  column?: number;
  token?: string;
  key?: string;
  partial?: string;
  path?: string;
}

export class LimaError extends Error {
  readonly code: LimaDiagnosticCode;
  readonly line?: number;
  readonly column?: number;
  readonly token?: string;
  readonly key?: string;
  readonly partial?: string;
  readonly path?: string;

  constructor(diagnostic: LimaDiagnostic) {
    super(diagnostic.message);
    this.name = "LimaError";
    Object.assign(this, diagnostic);
  }
}
```

No subclasses, no complex error hierarchy, and no fully normalized message
text.

## 11. Implementation order

Historical record of how the corpus and its runner were actually built —
both phases below are complete, kept here as the rationale for the
resulting architecture, not as a remaining plan.

### Phase 1: build the measuring instrument

1. Implement schema, loader, and generators.
2. Implement typed corpus values and result normalization.
3. Build diagnostic comparison and, if needed, a temporary legacy-error
   adapter.
4. Run the example cases.
5. Classify results as `PASS`, `FAIL`, or `BLOCKED`.

Parser semantics must not change during Phase 1.

Technical changes such as exports, test hooks, and exposing diagnostic
fields are permitted.

### Phase 2: fix confirmed deviations

Confirmed parser deviations are fixed in a targeted way only after human
review, followed by implementing further coverage points.

## 12. Files in this package

```text
docs/corpus-design/
├── README.md
├── error-api.md
└── coverage/
    ├── core.md
    └── references.md
```

The coverage files are the substantive task list. They are deliberately
more fine-grained than the example cases.

The schema (`case.schema.json`) and the example cases have moved into
the actual corpus:

```text
corpus/
├── core/          # taken over from examples/core/
├── references/     # taken over from examples/references/
├── schema/
│   └── case.schema.json
└── generated/       # still empty — generated boundary tests
```

`docs/corpus-design/` (originally `testkorpus-design/`, filed under `docs/`
since it is non-normative but, unlike an archive, still actively
maintained rationale + task list) no longer contains any test data.
