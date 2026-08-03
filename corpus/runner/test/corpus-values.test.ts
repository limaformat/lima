import { describe, it, expect } from 'bun:test'
import { materialize } from '../src/corpus-values'

describe('materialize', () => {
	it('passes through primitives unchanged', () => {
		expect(materialize(null)).toBeNull()
		expect(materialize(true)).toBe(true)
		expect(materialize(42)).toBe(42)
		expect(materialize('hello')).toBe('hello')
	})

	it('recurses into arrays', () => {
		expect(materialize([1, 'a', null, [true]])).toEqual([1, 'a', null, [true]])
	})

	it('recurses into plain mappings', () => {
		expect(materialize({ a: 1, b: { c: 'x' } })).toEqual({ a: 1, b: { c: 'x' } })
	})

	it('materializes an instant marker to a UTC Date', () => {
		const result = materialize({ $type: 'instant', value: '2024-03-01T09:00:00Z' }) as Date
		expect(result).toBeInstanceOf(Date)
		expect(result.toISOString()).toBe('2024-03-01T09:00:00.000Z')
	})

	it('throws for a malformed instant value', () => {
		expect(() => materialize({ $type: 'instant', value: 'not-a-date' })).toThrow()
	})

	it.each([
		['nan', NaN],
		['infinity', Infinity],
		['-infinity', -Infinity],
	] as const)('materializes host-number %s', (literal, expected) => {
		expect(materialize({ $type: 'host-number', value: literal })).toBe(expected)
	})

	it('materializes host-number -0 as negative zero', () => {
		const result = materialize({ $type: 'host-number', value: '-0' }) as number
		expect(Object.is(result, -0)).toBe(true)
	})

	it('materializes host-date "invalid" to an invalid Date', () => {
		const result = materialize({ $type: 'host-date', value: 'invalid' }) as Date
		expect(result).toBeInstanceOf(Date)
		expect(Number.isNaN(result.getTime())).toBe(true)
	})

	it('materializes host-date "year-underflow" to UTC year 0 (not the two-digit-year quirk)', () => {
		const result = materialize({ $type: 'host-date', value: 'year-underflow' }) as Date
		expect(result.getUTCFullYear()).toBe(0)
	})

	it('materializes host-date "year-overflow" to a UTC year beyond 9999', () => {
		const result = materialize({ $type: 'host-date', value: 'year-overflow' }) as Date
		expect(result.getUTCFullYear()).toBe(10000)
	})

	it('materializes nested markers inside arrays and mappings', () => {
		const result = materialize({
			items: [{ $type: 'host-number', value: 'nan' }],
		}) as { items: number[] }
		expect(Number.isNaN(result.items[0])).toBe(true)
	})
})
