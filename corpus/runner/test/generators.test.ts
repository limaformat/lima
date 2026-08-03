import { describe, it, expect } from 'bun:test'
import { runGenerator, IMPLEMENTED, NOT_YET_IMPLEMENTED } from '../src/generators'

describe('repeated-scalar', () => {
	it('repeats codePoint length times after "key: "', () => {
		const result = runGenerator('repeated-scalar', { key: 'value', codePoint: 'x', length: 5 })
		expect(result).toBe('value: xxxxx')
	})

	it('matches the parameters used by corpus/core/scalar-limit-above.json', () => {
		const result = runGenerator('repeated-scalar', { key: 'value', codePoint: 'x', length: 16385 })
		expect(result).toBe('value: ' + 'x'.repeat(16385))
	})

	it('is deterministic', () => {
		const params = { key: 'k', codePoint: 'y', length: 10 }
		expect(runGenerator('repeated-scalar', params)).toBe(runGenerator('repeated-scalar', params))
	})
})

describe('document-bytes', () => {
	it('produces a document of exactly the requested byte length', () => {
		const result = runGenerator('document-bytes', { length: 20 })
		expect(new TextEncoder().encode(result).length).toBe(20)
		expect(result.startsWith('k0: ')).toBe(true)
	})

	it('supports a custom fill code point', () => {
		const result = runGenerator('document-bytes', { length: 13, fillCodePoint: 'z' })
		expect(new TextEncoder().encode(result).length).toBe(13)
		expect(result).toBe('k0: ' + 'z'.repeat(9))
	})

	it('throws when length is smaller than the smallest possible line', () => {
		expect(() => runGenerator('document-bytes', { length: 1 })).toThrow()
	})

	it('splits large documents across multiple keys, staying under the scalar-length limit', () => {
		for (const length of [65536, 65537]) {
			const result = runGenerator('document-bytes', { length })
			expect(new TextEncoder().encode(result).length).toBe(length)
			const lines = result.split('\n')
			for (const line of lines) {
				const value = line.slice(line.indexOf(': ') + 2)
				expect(value.length).toBeLessThan(16384) // Core §9 scalar-length limit
			}
			expect(lines.length).toBeLessThan(128) // Core §9 top-level-entry limit
		}
	})

	it('produces distinct, sequentially numbered top-level keys', () => {
		const result = runGenerator('document-bytes', { length: 65536 })
		const keys = result.split('\n').map((line) => line.slice(0, line.indexOf(':')))
		expect(keys).toEqual(keys.map((_, i) => `k${i}`))
		expect(new Set(keys).size).toBe(keys.length)
	})
})

describe('nested-mappings', () => {
	it('produces a flat document at depth 0', () => {
		expect(runGenerator('nested-mappings', { depth: 0 })).toBe('k: v')
	})

	it('produces one nested level at depth 1', () => {
		expect(runGenerator('nested-mappings', { depth: 1 })).toBe('k:\n  k: v')
	})

	it('produces the exact line count for depth N', () => {
		const result = runGenerator('nested-mappings', { depth: 16 })
		expect(result.split('\n')).toHaveLength(17)
	})
})

describe('repeated-key', () => {
	it('produces count distinct top-level keys', () => {
		const result = runGenerator('repeated-key', { count: 3, keyPrefix: 'k', value: 'v' })
		expect(result).toBe('k0: v\nk1: v\nk2: v')
	})

	it('produces exactly count lines', () => {
		const result = runGenerator('repeated-key', { count: 128 })
		expect(result.split('\n')).toHaveLength(128)
	})
})

describe('generator dispatch', () => {
	it('exposes exactly the four first-stage generators as implemented', () => {
		expect(Object.keys(IMPLEMENTED).sort()).toEqual(
			['document-bytes', 'nested-mappings', 'repeated-key', 'repeated-scalar'].sort()
		)
	})

	it('throws a clear "not implemented" error for known-but-unimplemented generators', () => {
		for (const name of NOT_YET_IMPLEMENTED) {
			expect(() => runGenerator(name, {})).toThrow(/not implemented/)
		}
	})

	it('throws for a completely unknown generator name', () => {
		expect(() => runGenerator('does-not-exist', {})).toThrow(/unknown/)
	})
})
