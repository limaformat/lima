# Small public Lima error API

## Goal

Errors, warnings, and the conformance corpus use the same lean diagnostic
core.

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

## Warnings

`onWarning` receives a `LimaDiagnostic` directly.

## Code groups

- `INVALID_ESCAPE`
- `INVALID_QUOTE`
- `INVALID_DATE`
- `INVALID_NUMBER`
- `INVALID_REFERENCE_SHAPE`
- `INVALID_INDENTATION`
- `INVALID_FLOW_SYNTAX`
- `DUPLICATE_KEY`
- `RESOURCE_LIMIT`
- `UNRESOLVED_REFERENCE`
- `INVALID_INTERPOLATION`
- `INVALID_PARTIAL`

The codes stay deliberately coarse. Detail lives in `message` and the
optional context fields. `INVALID_QUOTE` covers quote-structure errors
that are not about escape-sequence content: non-whitespace content after
a closing quote, and an unterminated quoted string (Core §10.1) — added
after the corpus surfaced that neither condition had a clean fit among
the original nine codes. `INVALID_NUMBER` covers the two Core §6.4.2
strict-mode number errors — float overflow to a non-finite value, and a
syntactically non-zero float underflowing to zero — added for the same
reason: neither is a date, quote, or resource-limit error.
`INVALID_REFERENCE_SHAPE` covers a *pure*-reference resolution producing
a value that violates the shape of its insertion context — currently: a
reference resolving to an array, inserted as a sequence item, which
would produce a nested array (References §3.1/Appendix; forbidden by
Core §7.2's "sequences contain scalars or mappings only"). Distinct from
`INVALID_INTERPOLATION`, which covers the equivalent string-interpolation
rules (§3.5/§3.6) — this one is pure-reference mode, not interpolation.

## Non-goals

- no error subclasses
- no error trees
- no collecting multiple errors per throw
- no fully normalized English message text
- no separate corpus codes
