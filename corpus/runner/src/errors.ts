/**
 * Small public Lima error API, as defined in docs/corpus-design/error-api.md.
 * The diagnostic core (`LimaDiagnosticCode`/`LimaDiagnostic`/`LimaError`)
 * lives in `js/src/errors.ts` — it is not a corpus-only concept, `js/src`'s
 * own parser throws these directly. This module re-exports that core and
 * adds the corpus-comparison-only pieces (`DiagnosticExpectation`,
 * `compareDiagnostic`) that have no meaning outside the conformance runner.
 */

export { type LimaDiagnosticCode, type LimaDiagnostic, LimaError } from '../../../js/src/errors'
import type { LimaDiagnostic, LimaDiagnosticCode } from '../../../js/src/errors'

/**
 * The subset of diagnostic fields a corpus case may assert on. Only fields
 * present in `expected` are compared — this mirrors docs/corpus-design/
 * README.md §6: the corpus compares semantic fields, not full message text.
 */
export type DiagnosticExpectation = Partial<LimaDiagnostic> & { code: LimaDiagnosticCode; contains?: string }

export interface DiagnosticMismatch {
	field: keyof DiagnosticExpectation
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
