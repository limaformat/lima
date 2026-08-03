import { describe, it, expect } from 'bun:test'
import { runGenerator, IMPLEMENTED } from '../src/generators'

describe('repeated-scalar', () => {
	it('repeats codePoint length times after "key: "', () => {
		const result = runGenerator('repeated-scalar', { key: 'value', codePoint: 'x', length: 5 })
		expect(result.input).toBe('value: xxxxx')
		expect(result.partials).toBeUndefined()
	})

	it('matches the parameters used by corpus/core/scalar-limit-above.json', () => {
		const result = runGenerator('repeated-scalar', { key: 'value', codePoint: 'x', length: 16385 })
		expect(result.input).toBe('value: ' + 'x'.repeat(16385))
	})

	it('is deterministic', () => {
		const params = { key: 'k', codePoint: 'y', length: 10 }
		expect(runGenerator('repeated-scalar', params)).toEqual(runGenerator('repeated-scalar', params))
	})
})

describe('document-bytes', () => {
	it('produces a document of exactly the requested byte length', () => {
		const result = runGenerator('document-bytes', { length: 20 })
		expect(new TextEncoder().encode(result.input).length).toBe(20)
		expect(result.input.startsWith('k0: ')).toBe(true)
	})

	it('supports a custom fill code point', () => {
		const result = runGenerator('document-bytes', { length: 13, fillCodePoint: 'z' })
		expect(new TextEncoder().encode(result.input).length).toBe(13)
		expect(result.input).toBe('k0: ' + 'z'.repeat(9))
	})

	it('throws when length is smaller than the smallest possible line', () => {
		expect(() => runGenerator('document-bytes', { length: 1 })).toThrow()
	})

	it('splits large documents across multiple keys, staying under the scalar-length limit', () => {
		for (const length of [65536, 65537]) {
			const result = runGenerator('document-bytes', { length })
			expect(new TextEncoder().encode(result.input).length).toBe(length)
			const lines = result.input.split('\n')
			for (const line of lines) {
				const value = line.slice(line.indexOf(': ') + 2)
				expect(value.length).toBeLessThan(16384) // Core §9 scalar-length limit
			}
			expect(lines.length).toBeLessThan(128) // Core §9 top-level-entry limit
		}
	})

	it('produces distinct, sequentially numbered top-level keys', () => {
		const result = runGenerator('document-bytes', { length: 65536 })
		const keys = result.input.split('\n').map((line) => line.slice(0, line.indexOf(':')))
		expect(keys).toEqual(keys.map((_, i) => `k${i}`))
		expect(new Set(keys).size).toBe(keys.length)
	})
})

describe('nested-mappings', () => {
	it('produces a flat document at depth 0', () => {
		expect(runGenerator('nested-mappings', { depth: 0 }).input).toBe('k: v')
	})

	it('produces one nested level at depth 1', () => {
		expect(runGenerator('nested-mappings', { depth: 1 }).input).toBe('k:\n  k: v')
	})

	it('produces the exact line count for depth N', () => {
		const result = runGenerator('nested-mappings', { depth: 16 })
		expect(result.input.split('\n')).toHaveLength(17)
	})
})

describe('repeated-key', () => {
	it('produces count distinct top-level keys', () => {
		const result = runGenerator('repeated-key', { count: 3, keyPrefix: 'k', value: 'v' })
		expect(result.input).toBe('k0: v\nk1: v\nk2: v')
	})

	it('produces exactly count lines', () => {
		const result = runGenerator('repeated-key', { count: 128 })
		expect(result.input.split('\n')).toHaveLength(128)
	})
})

describe('partial-count', () => {
	it('produces count distinct partial names with an empty document', () => {
		const result = runGenerator('partial-count', { count: 3 })
		expect(result.input).toBe('')
		expect(result.partials).toEqual({ p0: 'v', p1: 'v', p2: 'v' })
	})

	it('supports a custom name prefix', () => {
		const result = runGenerator('partial-count', { count: 2, namePrefix: 'name' })
		expect(Object.keys(result.partials!)).toEqual(['name0', 'name1'])
	})

	it('produces exactly count partial names', () => {
		const result = runGenerator('partial-count', { count: 128 })
		expect(Object.keys(result.partials!)).toHaveLength(128)
	})
})

describe('partial-node-tree', () => {
	it('produces a single partial with exactly totalNodes nodes', () => {
		// nodeCount(array) = 1 + sum(nodeCount(element)); array of N-1 scalars.
		const result = runGenerator('partial-node-tree', { totalNodes: 10 })
		const [value] = Object.values(result.partials!) as unknown[][]
		expect(value).toHaveLength(9)
	})

	it('uses a custom partial name', () => {
		const result = runGenerator('partial-node-tree', { totalNodes: 5, partialName: 'tree' })
		expect(Object.keys(result.partials!)).toEqual(['tree'])
	})

	it('produces exactly 4,096 nodes for the References §6.2 boundary', () => {
		const result = runGenerator('partial-node-tree', { totalNodes: 4096 })
		const [value] = Object.values(result.partials!) as unknown[][]
		expect(1 + value.length).toBe(4096)
	})
})

describe('result-node-expansion', () => {
	it('produces topLevelKeys references to the same partial', () => {
		const result = runGenerator('result-node-expansion', { topLevelKeys: 3, partialNodes: 5 })
		expect(result.input).toBe('k0: (%big)\nk1: (%big)\nk2: (%big)')
		const [value] = Object.values(result.partials!) as unknown[][]
		expect(1 + value.length).toBe(5)
	})

	it('supports custom key prefix and partial name', () => {
		const result = runGenerator('result-node-expansion', {
			topLevelKeys: 2,
			partialNodes: 3,
			keyPrefix: 'item',
			partialName: 'shared',
		})
		expect(result.input).toBe('item0: (%shared)\nitem1: (%shared)')
		expect(Object.keys(result.partials!)).toEqual(['shared'])
	})
})

describe('generator dispatch', () => {
	it('exposes all seven generator names from the schema as implemented', () => {
		expect(Object.keys(IMPLEMENTED).sort()).toEqual(
			[
				'document-bytes',
				'nested-mappings',
				'repeated-key',
				'repeated-scalar',
				'partial-count',
				'partial-node-tree',
				'result-node-expansion',
			].sort()
		)
	})

	it('throws for a completely unknown generator name', () => {
		expect(() => runGenerator('does-not-exist', {})).toThrow(/unknown/)
	})
})
