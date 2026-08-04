/**
 * Structured internal diagnostics. The public parser API (Core §11.3)
 * remains a plain `Error` with just `.message` — Core §11.3 explicitly
 * permits subclasses as long as `instanceof Error` and `.message` still
 * work, so `LimaError` carries the same message text plus additional,
 * non-normative fields (`code`, `line`, `token`, `key`, `partial`, `path`)
 * that let a caller (or the conformance corpus runner, which imports this
 * module directly rather than duplicating it) inspect *why* a parse failed
 * without re-parsing the message string.
 */

export type LimaDiagnosticCode =
	| 'INVALID_ESCAPE'
	| 'INVALID_QUOTE'
	| 'INVALID_DATE'
	| 'INVALID_NUMBER'
	| 'INVALID_REFERENCE_SHAPE'
	| 'INVALID_INDENTATION'
	| 'INVALID_FLOW_SYNTAX'
	| 'DUPLICATE_KEY'
	| 'RESOURCE_LIMIT'
	| 'UNRESOLVED_REFERENCE'
	| 'INVALID_INTERPOLATION'
	| 'INVALID_PARTIAL'

export interface LimaDiagnostic {
	code: LimaDiagnosticCode
	message: string
	line?: number
	column?: number
	token?: string
	key?: string
	partial?: string
	path?: string
}

export class LimaError extends Error {
	readonly code!: LimaDiagnosticCode
	readonly line?: number
	readonly column?: number
	readonly token?: string
	readonly key?: string
	readonly partial?: string
	readonly path?: string

	constructor(diagnostic: LimaDiagnostic) {
		super(diagnostic.message)
		this.name = 'LimaError'
		Object.assign(this, diagnostic)
	}
}
