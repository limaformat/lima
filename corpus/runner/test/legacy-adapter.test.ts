import { describe, it, expect } from 'bun:test'
import { adaptLegacyError } from '../src/legacy-adapter'

describe('adaptLegacyError', () => {
	it('maps a duplicate-key error with key and line', () => {
		const result = adaptLegacyError(
			new Error('LIMA: duplicate key "title" at line 2 — last value wins')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('DUPLICATE_KEY')
			expect(result.diagnostic.key).toBe('title')
			expect(result.diagnostic.line).toBe(2)
		}
	})

	it('maps an unresolved-reference error, honestly omitting the missing line number', () => {
		const result = adaptLegacyError(new Error('LIMA: unresolved reference "($missing)"'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('UNRESOLVED_REFERENCE')
			expect(result.diagnostic.token).toBe('($missing)')
			expect(result.diagnostic.line).toBeUndefined()
		}
	})

	it('maps a partial reference token with the % sigil', () => {
		const result = adaptLegacyError(new Error('LIMA: unresolved reference "(%missing)"'))
		expect(result.mapped).toBe(true)
		if (result.mapped) expect(result.diagnostic.token).toBe('(%missing)')
	})

	it('maps an invalid flow mapping item to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(
			new Error('LIMA: invalid flow mapping item (missing ": ") at line 5: "x"')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
			expect(result.diagnostic.line).toBe(5)
		}
	})

	it('maps unexpected indentation to INVALID_INDENTATION', () => {
		const result = adaptLegacyError(new Error('LIMA: unexpected indentation at line 4: "x"'))
		expect(result.mapped).toBe(true)
		if (result.mapped) expect(result.diagnostic.code).toBe('INVALID_INDENTATION')
	})

	it('maps a nested block sequence to INVALID_INDENTATION', () => {
		const result = adaptLegacyError(new Error('LIMA: nested block sequence at line 2: "- - 1"'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_INDENTATION')
			expect(result.diagnostic.line).toBe(2)
		}
	})

	it('maps indented freetext without a block scalar marker to INVALID_INDENTATION', () => {
		const result = adaptLegacyError(
			new Error('LIMA: indented freetext without a block scalar marker at line 2: "x"')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_INDENTATION')
			expect(result.diagnostic.line).toBe(2)
		}
	})

	it('maps an invalid date component to INVALID_DATE', () => {
		const result = adaptLegacyError(new Error('LIMA: invalid date "2024-02-30" at line 1'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_DATE')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps float overflow to INVALID_NUMBER', () => {
		const result = adaptLegacyError(
			new Error('LIMA: float value overflows to a non-finite value at line 1: "1e400"')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_NUMBER')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps non-zero float underflow to zero to INVALID_NUMBER', () => {
		const result = adaptLegacyError(
			new Error('LIMA: non-zero float value underflows to zero at line 1: "1e-400"')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_NUMBER')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps a reference resolving to an array as a sequence item to INVALID_REFERENCE_SHAPE', () => {
		const result = adaptLegacyError(
			new Error('LIMA: reference "($a)" resolves to an array, which cannot be inserted as a sequence item at line 3')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_REFERENCE_SHAPE')
			expect(result.diagnostic.line).toBe(3)
		}
	})

	it('maps an unknown escape sequence to INVALID_ESCAPE', () => {
		const result = adaptLegacyError(new Error('LIMA: unknown escape sequence "\\q" at line 1'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_ESCAPE')
			expect(result.diagnostic.line).toBe(1)
			expect(result.diagnostic.message).toContain('\\q')
		}
	})

	it('maps trailing content after a closing quote to INVALID_QUOTE', () => {
		const result = adaptLegacyError(
			new Error('LIMA: non-whitespace content after closing quote at line 1')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_QUOTE')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps space between closing quote and colon to INVALID_QUOTE', () => {
		const result = adaptLegacyError(
			new Error('LIMA: space between closing quote and colon at line 1')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_QUOTE')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps an empty flow sequence element to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(new Error('LIMA: empty element in flow sequence at line 1'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps an empty flow mapping element to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(new Error('LIMA: empty element in flow mapping at line 1'))
		expect(result.mapped).toBe(true)
		if (result.mapped) expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
	})

	it('maps a nested flow sequence to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(
			new Error('LIMA: nested flow sequence not permitted at line 1: "[1, 2]"')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps invalid flow nesting inside a flow mapping to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(new Error('LIMA: invalid flow nesting at line 1: "{c: 1}"'))
		expect(result.mapped).toBe(true)
		if (result.mapped) expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
	})

	it('maps an unclosed flow sequence to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(new Error('LIMA: unclosed flow sequence at line 1'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps an unclosed flow mapping to INVALID_FLOW_SYNTAX', () => {
		const result = adaptLegacyError(new Error('LIMA: unclosed flow mapping at line 1'))
		expect(result.mapped).toBe(true)
		if (result.mapped) expect(result.diagnostic.code).toBe('INVALID_FLOW_SYNTAX')
	})

	it('maps a scalar-length limit error to RESOURCE_LIMIT', () => {
		const result = adaptLegacyError(
			new Error('LIMA: scalar exceeds maximum length of 16384 code points at line 1')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('RESOURCE_LIMIT')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('maps an invalid interpolation error with token and line', () => {
		const result = adaptLegacyError(
			new Error(
				'LIMA: invalid interpolation of "($person)" at line 3: mapping cannot be interpolated into a string'
			)
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_INTERPOLATION')
			expect(result.diagnostic.token).toBe('($person)')
			expect(result.diagnostic.line).toBe(3)
		}
	})

	it('maps an invalid partial error with partial name and path', () => {
		const result = adaptLegacyError(
			new Error('LIMA: invalid partial "bad" at path "bad": non-finite number')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_PARTIAL')
			expect(result.diagnostic.partial).toBe('bad')
			expect(result.diagnostic.path).toBe('bad')
			expect(result.diagnostic.line).toBeUndefined()
		}
	})

	it('maps an invalid partial error whose reason text itself contains "invalid date" without misrouting to INVALID_DATE', () => {
		// Regression guard: the invalid-partial rule must be checked before
		// the generic /invalid date/ rule, or a message like this one would
		// incorrectly match that broader pattern instead.
		const result = adaptLegacyError(new Error('LIMA: invalid partial "d" at path "d": invalid date'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_PARTIAL')
			expect(result.diagnostic.partial).toBe('d')
		}
	})

	it('maps a too-many-partials error to INVALID_PARTIAL with no partial/path attribution', () => {
		const result = adaptLegacyError(new Error('LIMA: too many partials (max 128)'))
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('INVALID_PARTIAL')
			expect(result.diagnostic.partial).toBeUndefined()
		}
	})

	it('maps a combined partial-node-budget error to INVALID_PARTIAL', () => {
		const result = adaptLegacyError(
			new Error('LIMA: partials exceed the combined maximum of 4096 value nodes')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) expect(result.diagnostic.code).toBe('INVALID_PARTIAL')
	})

	it('maps a final result node-count error to RESOURCE_LIMIT', () => {
		const result = adaptLegacyError(
			new Error('LIMA: result exceeds maximum size of 65536 total nodes at line 1')
		)
		expect(result.mapped).toBe(true)
		if (result.mapped) {
			expect(result.diagnostic.code).toBe('RESOURCE_LIMIT')
			expect(result.diagnostic.line).toBe(1)
		}
	})

	it('reports unmapped rather than guessing for an unrecognised message', () => {
		const result = adaptLegacyError(
			new Error('LIMA: mixed array and map entries for the same key at line 9')
		)
		expect(result.mapped).toBe(false)
		if (!result.mapped) expect(result.rawMessage).toContain('mixed array and map entries')
	})

	it('handles non-Error thrown values by stringifying them', () => {
		const result = adaptLegacyError('a plain string throw')
		expect(result.mapped).toBe(false)
		if (!result.mapped) expect(result.rawMessage).toBe('a plain string throw')
	})
})
