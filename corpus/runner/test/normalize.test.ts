import { describe, it, expect } from 'bun:test'
import { corpusValuesEqual, diffCorpusValues, hasOnlySafeOwnDataProperties } from '../src/normalize'

describe('corpusValuesEqual', () => {
	it('compares primitives strictly', () => {
		expect(corpusValuesEqual('a', 'a')).toBe(true)
		expect(corpusValuesEqual('a', 'b')).toBe(false)
		expect(corpusValuesEqual(true, true)).toBe(true)
		expect(corpusValuesEqual(null, null)).toBe(true)
		expect(corpusValuesEqual(null, undefined)).toBe(false)
	})

	it('compares numbers with Object.is semantics (-0 and NaN)', () => {
		expect(corpusValuesEqual(-0, 0)).toBe(false)
		expect(corpusValuesEqual(0, 0)).toBe(true)
		expect(corpusValuesEqual(NaN, NaN)).toBe(true)
		expect(corpusValuesEqual(NaN, 1)).toBe(false)
	})

	it('compares Dates as UTC instants, by timestamp not identity', () => {
		const a = new Date('2024-03-01T09:00:00Z')
		const b = new Date('2024-03-01T09:00:00Z')
		expect(a).not.toBe(b)
		expect(corpusValuesEqual(a, b)).toBe(true)
		expect(corpusValuesEqual(a, new Date('2024-03-01T09:00:01Z'))).toBe(false)
	})

	it('treats two invalid Dates as equal', () => {
		expect(corpusValuesEqual(new Date(NaN), new Date(NaN))).toBe(true)
	})

	it('is order-sensitive for arrays', () => {
		expect(corpusValuesEqual([1, 2], [2, 1])).toBe(false)
		expect(corpusValuesEqual([1, 2], [1, 2])).toBe(true)
	})

	it('is order-independent for mapping keys', () => {
		expect(corpusValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
	})

	it('detects missing or extra mapping keys', () => {
		expect(corpusValuesEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
		expect(corpusValuesEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false)
	})

	it('recurses into nested structures', () => {
		expect(
			corpusValuesEqual({ tags: ['a', { x: 1 }] }, { tags: ['a', { x: 1 }] })
		).toBe(true)
		expect(
			corpusValuesEqual({ tags: ['a', { x: 1 }] }, { tags: ['a', { x: 2 }] })
		).toBe(false)
	})
})

describe('diffCorpusValues', () => {
	it('returns no diffs for equal values', () => {
		expect(diffCorpusValues({ a: 1 }, { a: 1 })).toEqual([])
	})

	it('reports a missing key', () => {
		const diffs = diffCorpusValues({}, { a: 1 })
		expect(diffs).toEqual(['$.a: missing in actual result'])
	})

	it('reports an unexpected key', () => {
		const diffs = diffCorpusValues({ a: 1 }, {})
		expect(diffs).toEqual(['$.a: unexpected key in actual result'])
	})

	it('reports an array length mismatch', () => {
		const diffs = diffCorpusValues([1], [1, 2])
		expect(diffs[0]).toContain('expected array of length 2, got length 1')
	})

	it('points at the exact nested path of a mismatch', () => {
		const diffs = diffCorpusValues({ a: { b: 1 } }, { a: { b: 2 } })
		expect(diffs).toEqual(['$.a.b: expected 2, got 1'])
	})
})

describe('hasOnlySafeOwnDataProperties', () => {
	it('accepts primitives, null, and Date', () => {
		expect(hasOnlySafeOwnDataProperties('x')).toBe(true)
		expect(hasOnlySafeOwnDataProperties(null)).toBe(true)
		expect(hasOnlySafeOwnDataProperties(new Date())).toBe(true)
	})

	it('accepts a prototype-free object with own data properties', () => {
		const obj = Object.create(null)
		obj.a = 1
		expect(hasOnlySafeOwnDataProperties(obj)).toBe(true)
	})

	it('rejects an ordinary object literal (Object.prototype in chain)', () => {
		expect(hasOnlySafeOwnDataProperties({ a: 1 })).toBe(false)
	})

	it('rejects an object with an accessor property', () => {
		const obj = Object.create(null)
		Object.defineProperty(obj, 'a', { get: () => 1, enumerable: true })
		expect(hasOnlySafeOwnDataProperties(obj)).toBe(false)
	})

	it('recurses into arrays and nested mappings', () => {
		const inner = Object.create(null)
		inner.x = 1
		const outer = Object.create(null)
		outer.list = [inner]
		expect(hasOnlySafeOwnDataProperties(outer)).toBe(true)

		const badInner = { x: 1 } // has Object.prototype
		const outerWithBad = Object.create(null)
		outerWithBad.list = [badInner]
		expect(hasOnlySafeOwnDataProperties(outerWithBad)).toBe(false)
	})
})
