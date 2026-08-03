/**
 * Small public Lima error API, as defined in docs/corpus-design/error-api.md.
 * The corpus runner uses this diagnostic core directly — it is not a
 * corpus-only concept.
 */

export type LimaDiagnosticCode =
	| 'INVALID_ESCAPE'
	| 'INVALID_DATE'
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
	readonly code: LimaDiagnosticCode
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

/**
 * The subset of diagnostic fields a corpus case may assert on. Only fields
 * present in `expected` are compared — this mirrors docs/corpus-design/
 * README.md §6: the corpus compares semantic fields, not full message text.
 */
export type DiagnosticExpectation = Partial<LimaDiagnostic> & { code: LimaDiagnosticCode }

export interface DiagnosticMismatch {
	field: keyof LimaDiagnostic
	expected: unknown
	actual: unknown
}

/**
 * Compares an actual diagnostic against a corpus expectation. Returns an
 * empty array when every asserted field matches.
 */
export function compareDiagnostic(
	actual: LimaDiagnostic,
	expected: DiagnosticExpectation
): DiagnosticMismatch[] {
	const mismatches: DiagnosticMismatch[] = []
	for (const field of Object.keys(expected) as (keyof DiagnosticExpectation)[]) {
		if (field === 'message') continue // full message text is never asserted (see error-api.md)
		const expectedValue = expected[field]
		if (field === 'contains') {
			// `contains` is a message excerpt check, not a field to match
			// exactly (error-api.md: "optional message excerpt").
			if (typeof expectedValue !== 'string' || !actual.message.includes(expectedValue)) {
				mismatches.push({ field, expected: expectedValue, actual: actual.message })
			}
			continue
		}
		const actualValue = actual[field]
		if (expectedValue !== actualValue) {
			mismatches.push({ field, expected: expectedValue, actual: actualValue })
		}
	}
	return mismatches
}
