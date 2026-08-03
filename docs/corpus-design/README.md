# Lima Conformance Corpus – Design Package

**Status:** design draft, prior to implementation
**Normative basis:** Lima Core 1.0 and Lima References 1.0
**Target platform for the first implementation:** TypeScript/Bun
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
```

Default values should not be spelled out in sidecars.

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
```

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

## 10. Small public error API

Lima should use a single error class plus a shared diagnostic core:

```ts
export type LimaDiagnosticCode =
  | "INVALID_ESCAPE"
  | "INVALID_DATE"
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
