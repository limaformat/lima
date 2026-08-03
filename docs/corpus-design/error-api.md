# Small public Lima error API

## Goal

Errors, warnings, and the conformance corpus use the same lean diagnostic
core.

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

## Warnings

`onWarning` receives a `LimaDiagnostic` directly.

## Code groups

- `INVALID_ESCAPE`
- `INVALID_DATE`
- `INVALID_INDENTATION`
- `INVALID_FLOW_SYNTAX`
- `DUPLICATE_KEY`
- `RESOURCE_LIMIT`
- `UNRESOLVED_REFERENCE`
- `INVALID_INTERPOLATION`
- `INVALID_PARTIAL`

The codes stay deliberately coarse. Detail lives in `message` and the
optional context fields.

## Non-goals

- no error subclasses
- no error trees
- no collecting multiple errors per throw
- no fully normalized English message text
- no separate corpus codes
