import { describe, it, expect } from 'bun:test'
import { forEachParser } from './test-helpers.js'

forEachParser((parse) => {

describe('arrays — flow sequence (inline [...])', () => {
	/**
	 * Flow sequence is the YAML 1.2 term for inline arrays written in square
	 * brackets: [a, b, c]. Also commonly called "flow array".
	 * This syntax is YAML-compatible and understood by tools like Obsidian.
	 */
	it('parses a flow sequence of strings', () => {
		expect(parse('tags: [javascript, webdev, open-source]'))
			.toEqual({ tags: ['javascript', 'webdev', 'open-source'] })
	})

	it('coerces types within flow sequences', () => {
		expect(parse('values: [1, true, false, hello]'))
			.toEqual({ values: [1, true, false, 'hello'] })
	})

	it('parses an empty flow sequence', () => {
		expect(parse('tags: []')).toEqual({ tags: [] })
	})

	it('produces the same result as a block sequence', () => {
		const block = parse(`
			tags:
			  - javascript
			  - webdev
		`)
		const flow = parse('tags: [javascript, webdev]')
		expect(flow.tags).toEqual(block.tags)
	})

	it('resolves references within flow sequence items', () => {
		const result = parse(`
			base: javascript
			tags: [($base), webdev]
		`)
		expect(result.tags).toEqual(['javascript', 'webdev'])
	})

	it('handles quoted items containing commas', () => {
		expect(parse('tags: [one, "two, three", four]'))
			.toEqual({ tags: ['one', 'two, three', 'four'] })
	})

	it('handles single-quoted items containing commas', () => {
		expect(parse("tags: [one, 'two, three', four]"))
			.toEqual({ tags: ['one', 'two, three', 'four'] })
	})

	it('quoted numbers stay as strings — no type coercion', () => {
		expect(parse('values: ["42", "true", unquoted]'))
			.toEqual({ values: ['42', 'true', 'unquoted'] })
	})

	it('parses null and ~ as null inside flow sequences', () => {
		expect(parse('values: [null, ~, hello]')).toEqual({ values: [null, null, 'hello'] })
	})

	it('mix of quoted and unquoted with type coercion', () => {
		expect(parse('values: [42, "hello", true, "false"]'))
			.toEqual({ values: [42, 'hello', true, 'false'] })
	})

	it('escaped double quote inside a double-quoted item', () => {
		expect(parse('values: ["He said \\"Hello\\"", next]'))
			.toEqual({ values: ['He said "Hello"', 'next'] })
	})

	it('escaped single quote inside a single-quoted item', () => {
		expect(parse("values: ['it\\'s fine', next]"))
			.toEqual({ values: ["it's fine", 'next'] })
	})

	it('unclosed [ falls back to string — not parsed as flow sequence', () => {
		expect(parse('tags: [unclosed')).toEqual({ tags: '[unclosed' })
	})

	it('throws on an unclosed [ in strict mode, at the line of the opening bracket', () => {
		expect(() => parse('tags: [unclosed', { strict: true })).toThrow('Lima')
	})

	it('drops a trailing comma entirely in non-strict mode — not a trailing null item', () => {
		expect(parse('tags: [a, b,]')).toEqual({ tags: ['a', 'b'] })
	})

	it('leading/consecutive commas become null items in non-strict mode', () => {
		expect(parse('tags: [, a,, b]')).toEqual({ tags: [null, 'a', null, 'b'] })
	})

	it('throws on an empty flow sequence element in strict mode', () => {
		expect(() => parse('tags: [, a]', { strict: true })).toThrow('Lima')
	})

	it('a flow sequence may contain flow mappings one level deep', () => {
		const result = parse('menu: [{name: Home, url: /}, {name: About, url: /about}]')
		expect(result.menu).toEqual([
			{ name: 'Home', url: '/' },
			{ name: 'About', url: '/about' },
		])
	})

	it('throws in both modes on a directly nested flow sequence (Core §7.4)', () => {
		expect(() => parse('matrix: [[1, 2], [3, 4]]')).toThrow('Lima')
		expect(() => parse('matrix: [[1, 2], [3, 4]]', { strict: true })).toThrow('Lima')
	})

	it('throws in both modes on a flow sequence nested via an intermediate flow mapping (depth 2)', () => {
		expect(() => parse('a: [{key: [1,2]}]')).toThrow('Lima')
		expect(() => parse('a: [{key: [1,2]}]', { strict: true })).toThrow('Lima')
	})

	it('parses a flow sequence as a value inside a block map', () => {
		const result = parse(`
			nav:
			  main: [home, blog]
			  footer: [autor, impressum, datenschutz]
		`)
		expect(result.nav).toEqual({
			main: ['home', 'blog'],
			footer: ['autor', 'impressum', 'datenschutz'],
		})
	})

	it('parses a flow sequence as an inline value in a multi-key block array item', () => {
		const result = parse(`
			items:
			  - name: Widget
			    tags: [a, b, c]
		`)
		expect(result.items).toEqual([{ name: 'Widget', tags: ['a', 'b', 'c'] }])
	})

	it('parses a flow sequence as a continuation-line value in a multi-key array item', () => {
		const result = parse(`
			items:
			  - name: Widget
			    tags: [x, y]
			    count: 1
		`)
		expect(result.items).toEqual([{ name: 'Widget', tags: ['x', 'y'], count: 1 }])
	})
})

describe('maps — flow mapping (inline {...})', () => {
	it('parses an inline flow mapping as top-level value', () => {
		expect(parse('author: {name: Alice, role: editor}'))
			.toEqual({ author: { name: 'Alice', role: 'editor' } })
	})

	it('coerces types within flow mappings', () => {
		expect(parse('stats: {count: 42, active: true, ratio: 3.14}'))
			.toEqual({ stats: { count: 42, active: true, ratio: 3.14 } })
	})

	it('parses an empty flow mapping', () => {
		expect(parse('meta: {}')).toEqual({ meta: {} })
	})

	it('quoted values in flow mappings skip type coercion', () => {
		expect(parse('meta: {count: "42", flag: "true"}'))
			.toEqual({ meta: { count: '42', flag: 'true' } })
	})

	it('resolves references within flow mapping values', () => {
		const result = parse(`
			base: alice
			author: {name: ($base), role: editor}
		`)
		expect(result.author).toEqual({ name: 'alice', role: 'editor' })
	})

	it('parses flow mapping items in a block array: - {key: val}', () => {
		const result = parse(`
			menu:
			  - {name: Home, url: /, weight: 1}
			  - {name: About, url: /about, weight: 2}
		`)
		expect(result.menu).toEqual([
			{ name: 'Home',  url: '/',      weight: 1 },
			{ name: 'About', url: '/about', weight: 2 },
		])
	})

	it('parses flow mapping as a value within a block map', () => {
		const result = parse(`
			params:
			  author: {name: Alice, role: editor}
			  count: 1
		`)
		expect(result.params).toEqual({ author: { name: 'Alice', role: 'editor' }, count: 1 })
	})

	it('parses flow mapping as a continuation-line value in a multi-key array item', () => {
		const result = parse(`
			authors:
			  - name: Alice
			    contact: {email: alice@example.com, phone: 123}
		`)
		expect(result.authors).toEqual([{ name: 'Alice', contact: { email: 'alice@example.com', phone: 123 } }])
	})

	it('falls back to string when {} content is not key: val pairs', () => {
		expect(parse('note: {just some text}')).toEqual({ note: '{just some text}' })
	})

	it('parses null and ~ as null inside flow mappings', () => {
		expect(parse('meta: {a: null, b: ~, c: hello}')).toEqual({ meta: { a: null, b: null, c: 'hello' } })
	})

	it('escaped double quote inside a flow mapping value', () => {
		expect(parse('meta: {title: "He said \\"Hello\\"", count: 1}'))
			.toEqual({ meta: { title: 'He said "Hello"', count: 1 } })
	})

	it('unclosed { falls back to string — not parsed as flow mapping', () => {
		expect(parse('meta: {key: val')).toEqual({ meta: '{key: val' })
	})

	it('throws on an unclosed { in strict mode, at the line of the opening brace', () => {
		expect(() => parse('meta: {key: val', { strict: true })).toThrow('Lima')
	})

	it('drops a trailing comma entirely in non-strict mode — keeps the preceding entries', () => {
		expect(parse('meta: {a: 1, b: 2,}')).toEqual({ meta: { a: 1, b: 2 } })
	})

	it('skips a leading comma in non-strict mode — keeps the following entries', () => {
		expect(parse('meta: {, a: 1}')).toEqual({ meta: { a: 1 } })
	})

	it('throws on an empty flow mapping element in strict mode', () => {
		expect(() => parse('meta: {, a: 1}', { strict: true })).toThrow('Lima')
	})

	it('throws in both modes when a flow mapping value is itself a nested flow mapping (Core §7.5)', () => {
		expect(() => parse('meta: {a: {b: 1}}')).toThrow('Lima')
		expect(() => parse('meta: {a: {b: 1}}', { strict: true })).toThrow('Lima')
	})

	it('throws in both modes when a flow mapping value is a flow sequence', () => {
		expect(() => parse('meta: {a: [1, 2]}')).toThrow('Lima')
		expect(() => parse('meta: {a: [1, 2]}', { strict: true })).toThrow('Lima')
	})
})

})
