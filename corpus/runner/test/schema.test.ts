import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateCase } from '../src/schema'

const baseCase = {
	id: 'core.numbers.safe-integer.maximum',
	spec: 'core' as const,
	section: '6.4.2',
	description: 'Accepts the maximum safe integer.',
	input: 'value: 9007199254740991',
	expect: { result: { value: 9007199254740991 } },
}

describe('validateCase — structural rules', () => {
	it('accepts a minimal valid case', () => {
		expect(validateCase(baseCase)).toEqual({ valid: true, errors: [] })
	})

	it('rejects a non-object document', () => {
		expect(validateCase('not an object').valid).toBe(false)
	})

	it('rejects an unexpected top-level property', () => {
		const result = validateCase({ ...baseCase, bogus: true })
		expect(result.valid).toBe(false)
		expect(result.errors.some((e) => e.includes('bogus'))).toBe(true)
	})

	it('rejects a missing required property', () => {
		const { description, ...rest } = baseCase
		expect(validateCase(rest).valid).toBe(false)
	})

	it('rejects an id that does not match the id pattern', () => {
		expect(validateCase({ ...baseCase, id: 'not-a-valid-id' }).valid).toBe(false)
	})

	it('rejects an unknown spec value', () => {
		expect(validateCase({ ...baseCase, spec: 'unknown' }).valid).toBe(false)
	})

	it('requires exactly one of input, inputFile, generator', () => {
		const { input, ...withoutInput } = baseCase
		expect(validateCase(withoutInput).valid).toBe(false)

		const both = { ...baseCase, inputFile: 'case.lima' }
		expect(validateCase(both).valid).toBe(false)
	})

	it('accepts inputFile matching the filename pattern', () => {
		const { input, ...rest } = baseCase
		expect(validateCase({ ...rest, inputFile: 'case-name.lima' }).valid).toBe(true)
	})

	it('rejects an inputFile containing a path separator', () => {
		const { input, ...rest } = baseCase
		expect(validateCase({ ...rest, inputFile: 'dir/case.lima' }).valid).toBe(false)
	})

	it('accepts a generator case without input', () => {
		const { input, ...rest } = baseCase
		const result = validateCase({
			...rest,
			generator: { name: 'repeated-scalar', parameters: { key: 'value', codePoint: 'x', length: 5 } },
		})
		expect(result).toEqual({ valid: true, errors: [] })
	})

	it('rejects an unknown generator name', () => {
		const { input, ...rest } = baseCase
		const result = validateCase({
			...rest,
			generator: { name: 'not-a-generator', parameters: {} },
		})
		expect(result.valid).toBe(false)
	})

	it('requires exactly one of expect.result, expect.error', () => {
		expect(validateCase({ ...baseCase, expect: {} }).valid).toBe(false)
		expect(
			validateCase({ ...baseCase, expect: { result: {}, error: { code: 'DUPLICATE_KEY' } } }).valid
		).toBe(false)
	})

	it('accepts an error expectation with a valid diagnostic code', () => {
		const result = validateCase({ ...baseCase, expect: { error: { code: 'RESOURCE_LIMIT' } } })
		expect(result).toEqual({ valid: true, errors: [] })
	})

	it('rejects an invalid diagnostic code', () => {
		const result = validateCase({ ...baseCase, expect: { error: { code: 'NOT_A_CODE' } } })
		expect(result.valid).toBe(false)
	})

	it('accepts warnings alongside a result', () => {
		const result = validateCase({
			...baseCase,
			expect: { result: {}, warnings: [{ code: 'DUPLICATE_KEY', line: 2, key: 'title' }] },
		})
		expect(result).toEqual({ valid: true, errors: [] })
	})

	it('accepts typed corpus value markers in the result', () => {
		const result = validateCase({
			...baseCase,
			expect: {
				result: {
					published: { $type: 'instant', value: '2024-03-01T09:00:00Z' },
				},
			},
		})
		expect(result).toEqual({ valid: true, errors: [] })
	})

	it('rejects a malformed instant value', () => {
		const result = validateCase({
			...baseCase,
			expect: { result: { published: { $type: 'instant', value: 'not-a-date' } } },
		})
		expect(result.valid).toBe(false)
	})

	it('accepts each host-date sentinel', () => {
		for (const value of ['invalid', 'year-underflow', 'year-overflow']) {
			const result = validateCase({
				...baseCase,
				options: { partials: { bad: { $type: 'host-date', value } } },
			})
			expect(result).toEqual({ valid: true, errors: [] })
		}
	})

	it('rejects a host-date value outside the fixed sentinel set', () => {
		const result = validateCase({
			...baseCase,
			options: { partials: { bad: { $type: 'host-date', value: '2024-03-01T00:00:00Z' } } },
		})
		expect(result.valid).toBe(false)
	})

	it('rejects duplicate tags', () => {
		const result = validateCase({ ...baseCase, tags: ['limit', 'limit'] })
		expect(result.valid).toBe(false)
	})
})

describe('validateCase — real corpus fixtures', () => {
	const corpusRoot = join(import.meta.dir, '..', '..')
	for (const area of ['core', 'references']) {
		const dir = join(corpusRoot, area)
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
			it(`${area}/${file} validates against the schema`, () => {
				const doc = JSON.parse(readFileSync(join(dir, file), 'utf-8'))
				const result = validateCase(doc)
				expect(result.errors).toEqual([])
				expect(result.valid).toBe(true)
			})
		}
	}
})
