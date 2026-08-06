import { describe, it, expect } from 'bun:test'
import { LimaError, compareDiagnostic, type LimaDiagnostic } from '../src/errors'

describe('LimaError', () => {
	it('carries diagnostic fields as readonly properties', () => {
		const diagnostic: LimaDiagnostic = {
			code: 'UNRESOLVED_REFERENCE',
			message: 'unresolved reference',
			line: 3,
			token: '($missing)',
		}
		const error = new LimaError(diagnostic)
		expect(error).toBeInstanceOf(Error)
		expect(error.name).toBe('LimaError')
		expect(error.message).toBe('unresolved reference')
		expect(error.code).toBe('UNRESOLVED_REFERENCE')
		expect(error.line).toBe(3)
		expect(error.token).toBe('($missing)')
	})
})

describe('compareDiagnostic', () => {
	it('returns no mismatches when all asserted fields match', () => {
		const actual: LimaDiagnostic = {
			code: 'DUPLICATE_KEY',
			message: 'duplicate key "title" at line 2',
			line: 2,
			key: 'title',
		}
		const mismatches = compareDiagnostic(actual, { code: 'DUPLICATE_KEY', line: 2, key: 'title' })
		expect(mismatches).toEqual([])
	})

	it('ignores message text even when expected includes it', () => {
		const actual: LimaDiagnostic = { code: 'DUPLICATE_KEY', message: 'anything at all' }
		const mismatches = compareDiagnostic(actual, {
			code: 'DUPLICATE_KEY',
			message: 'a completely different message',
		})
		expect(mismatches).toEqual([])
	})

	it('reports a mismatch for each differing field', () => {
		const actual: LimaDiagnostic = { code: 'DUPLICATE_KEY', message: '', line: 5, key: 'a' }
		const mismatches = compareDiagnostic(actual, { code: 'RESOURCE_LIMIT', line: 2, key: 'a' })
		expect(mismatches).toEqual([
			{ field: 'code', expected: 'RESOURCE_LIMIT', actual: 'DUPLICATE_KEY' },
			{ field: 'line', expected: 2, actual: 5 },
		])
	})

	it('does not assert fields the expectation omits', () => {
		const actual: LimaDiagnostic = { code: 'DUPLICATE_KEY', message: '', line: 999, key: 'x' }
		const mismatches = compareDiagnostic(actual, { code: 'DUPLICATE_KEY' })
		expect(mismatches).toEqual([])
	})

	it('treats "contains" as a substring check against the message, not an exact field match', () => {
		const actual: LimaDiagnostic = {
			code: 'INVALID_ESCAPE',
			message: 'Lima: unknown escape sequence "\\q" at line 1',
		}
		expect(compareDiagnostic(actual, { code: 'INVALID_ESCAPE', contains: '\\q' })).toEqual([])
	})

	it('reports a mismatch when "contains" is not found in the message', () => {
		const actual: LimaDiagnostic = { code: 'INVALID_ESCAPE', message: 'no matching substring here' }
		const mismatches = compareDiagnostic(actual, { code: 'INVALID_ESCAPE', contains: '\\q' })
		expect(mismatches).toEqual([
			{ field: 'contains', expected: '\\q', actual: 'no matching substring here' },
		])
	})
})
