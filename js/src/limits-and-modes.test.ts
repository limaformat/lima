import { describe, it, expect } from 'bun:test'
import { forEachParser, dedent } from './test-helpers.js'

forEachParser((parse) => {

describe('duplicate keys', () => {
	it('last value wins (silent overwrite in non-strict mode)', () => {
		const result = parse(dedent(`
			title: First
			title: Second
		`))
		expect(result.title).toBe('Second')
	})

	it('emits a duplicate-key warning via onWarning, with message and line', () => {
		const warnings: { message: string; line: number }[] = []
		parse(dedent(`
			title: First
			title: Second
		`), { onWarning: (d) => warnings.push(d) })
		expect(warnings).toHaveLength(1)
		expect(warnings[0].message).toContain('duplicate key "title"')
		expect(warnings[0].line).toBe(2)
	})

	it('never emits warnings to console.warn (Core §11.2: only via onWarning)', () => {
		const orig = console.warn
		let called = false
		console.warn = () => { called = true }
		parse(dedent(`
			title: First
			title: Second
		`))
		console.warn = orig
		expect(called).toBe(false)
	})

	it('throws on duplicate key in strict mode', () => {
		expect(() => parse(dedent(`
			title: First
			title: Second
		`), { strict: true })).toThrow('duplicate key "title"')
	})

	it('duplicate key error includes line number in strict mode', () => {
		expect(() => parse(dedent(`
			a: 1
			b: 2
			a: 3
		`), { strict: true })).toThrow('at line 3')
	})

	it('warns and last-value-wins for a duplicate key in a nested block mapping', () => {
		const warnings: { message: string; line: number }[] = []
		const result = parse('author:\n  name: Alice\n  name: Bob', { onWarning: (d) => warnings.push(d) })
		expect(result.author).toEqual({ name: 'Bob' })
		expect(warnings).toHaveLength(1)
		expect(warnings[0].message).toContain('duplicate key "name"')
		expect(warnings[0].line).toBe(3)
	})

	it('throws on a duplicate key in a nested block mapping in strict mode', () => {
		expect(() => parse('author:\n  name: Alice\n  name: Bob', { strict: true })).toThrow(
			'at line 3'
		)
	})

	it('warns and last-value-wins for a duplicate key in a flow mapping', () => {
		const warnings: { message: string; line: number }[] = []
		const result = parse('author: {name: Alice, name: Bob}', { onWarning: (d) => warnings.push(d) })
		expect(result.author).toEqual({ name: 'Bob' })
		expect(warnings).toHaveLength(1)
		expect(warnings[0].message).toContain('duplicate key "name"')
	})

	it('throws on a duplicate key in a flow mapping in strict mode', () => {
		expect(() => parse('author: {name: Alice, name: Bob}', { strict: true })).toThrow(
			'duplicate key "name"'
		)
	})
})

describe('strict mode', () => {
	it('throws on unresolved pure ($key) reference', () => {
		expect(() => parse('count: ($missing)', { strict: true })).toThrow('LIMA')
	})

	it('throws on unresolved (%key) partial reference', () => {
		expect(() => parse('author: (%unknown)', { strict: true })).toThrow('LIMA')
	})

	it('throws on unresolved reference in interpolation', () => {
		expect(() => parse('title: Hello ($ghost)!', { strict: true })).toThrow('LIMA')
	})

	it('throws on invalid flow mapping item', () => {
		expect(() => parse('note: {just some text}', { strict: true })).toThrow('LIMA')
	})

	it('throws on non-whitespace content after a closing quote', () => {
		expect(() => parse('title: "Hello" trailing', { strict: true })).toThrow('LIMA')
	})

	it('does not throw on non-whitespace content after a closing quote in non-strict mode', () => {
		expect(parse('title: "Hello" trailing')).toEqual({ title: '"Hello" trailing' })
	})

	it('error messages include line number', () => {
		expect(() => parse('note: {just some text}', { strict: true })).toThrow('at line 1')
		expect(() => parse(dedent(`
			title: Hello
			note: {bad}
		`), { strict: true })).toThrow('at line 2')
	})

	it('a strict-mode failure is at minimum a plain Error with a message (Core §11.3)', () => {
		let caught: unknown
		try {
			parse('note: {just some text}', { strict: true })
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(Error)
		expect(typeof (caught as Error).message).toBe('string')
		expect((caught as Error).message.length).toBeGreaterThan(0)
	})

	it('does NOT throw on valid partials when passed via options', () => {
		expect(() =>
			parse('author: (%known)', { partials: { known: 'Alice' }, strict: true })
		).not.toThrow()
	})

	it('does NOT throw for valid references in non-strict mode', () => {
		expect(parse('count: ($missing)')).toEqual({ count: '($missing)' })
	})

	it('supports forward references in strict mode — throws only for genuinely missing keys', () => {
		// Forward ref: key appears later → second pass resolves it, no throw
		const result = parse(dedent(`
			b: ($a)
			a: hello
		`), { strict: true })
		expect(result.b).toBe('hello')
	})

	it('throws in strict mode when a forward-ref key does not exist at all', () => {
		expect(() => parse(dedent(`
			b: ($a)
			a: ($c)
		`), { strict: true })).toThrow('LIMA')
	})
})

describe('resource limits', () => {
	const nestedDoc = (depth: number): string => {
		const lines: string[] = []
		for (let level = 0; level < depth; level++) lines.push('  '.repeat(level) + 'k:')
		lines.push('  '.repeat(depth) + 'k: v')
		return lines.join('\n')
	}

	it('accepts a scalar exactly at the 16,384-code-point limit', () => {
		const result = parse(`value: ${'x'.repeat(16384)}`)
		expect((result.value as string).length).toBe(16384)
	})

	it('rejects a scalar one code point over the limit', () => {
		expect(() => parse(`value: ${'x'.repeat(16385)}`)).toThrow('LIMA')
	})

	it('rejects an oversized scalar inside a flow sequence', () => {
		expect(() => parse(`tags: [${'x'.repeat(16385)}]`)).toThrow('LIMA')
	})

	it('rejects an oversized scalar inside a flow mapping', () => {
		expect(() => parse(`author: {name: ${'x'.repeat(16385)}}`)).toThrow('LIMA')
	})

	it('rejects an oversized scalar inside a block array item', () => {
		expect(() => parse(`tags:\n  - ${'x'.repeat(16385)}`)).toThrow('LIMA')
	})

	it('rejects an oversized | block scalar', () => {
		expect(() => parse(`description: |\n  ${'x'.repeat(16385)}`)).toThrow('LIMA')
	})

	it('accepts a key exactly at the 128-code-point limit', () => {
		const key = 'k'.repeat(128)
		expect(parse(`${key}: value`)[key]).toBe('value')
	})

	it('rejects a key exceeding the 128-code-point limit', () => {
		expect(() => parse(`${'k'.repeat(129)}: value`)).toThrow('LIMA')
	})

	it('accepts exactly 128 top-level key entries', () => {
		const doc = Array.from({ length: 128 }, (_, i) => `k${i}: v`).join('\n')
		expect(Object.keys(parse(doc))).toHaveLength(128)
	})

	it('rejects more than 128 top-level key entries', () => {
		const doc = Array.from({ length: 129 }, (_, i) => `k${i}: v`).join('\n')
		expect(() => parse(doc)).toThrow('LIMA')
	})

	it('rejects a document exceeding the 64 KB size limit', () => {
		expect(() => parse('k: ' + 'x'.repeat(70000))).toThrow('LIMA')
	})

	it('keeps the UTF-16 length shortcut below the 64 KB UTF-8 limit', () => {
		expect(() => parse('\u0800'.repeat(21845))).not.toThrow()
	})

	it('still measures UTF-8 bytes immediately above the safe shortcut bound', () => {
		expect(() => parse('\u0800'.repeat(21846))).toThrow('LIMA')
	})

	it('accepts nesting exactly at the 16-level limit', () => {
		expect(() => parse(nestedDoc(16))).not.toThrow()
	})

	it('rejects nesting one level deeper than the limit', () => {
		expect(() => parse(nestedDoc(17))).toThrow('LIMA')
	})
})

})
