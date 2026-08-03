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
