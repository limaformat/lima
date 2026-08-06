import { describe, it, expect } from 'bun:test'
import { forEachParser } from './test-helpers.js'

forEachParser((parse) => {

describe('arrays — block sequence (dash-prefixed)', () => {
	it('parses a dash-prefixed list', () => {
		const result = parse(`
			tags:
			  - javascript
			  - webdev
		`)
		expect(result.tags).toEqual(['javascript', 'webdev'])
	})

	it('coerces types within block arrays', () => {
		const result = parse(`
			values:
			  - 42
			  - true
			  - hello
		`)
		expect(result.values).toEqual([42, true, 'hello'])
	})

	it('consumes the complete whitespace run after a dash', () => {
		const result = parse("values:\n  -  value\n  -   'quoted'\n  -  [1, 2]\n  -  {a: 1}\n")
		expect(result.values).toEqual(['value', 'quoted', '[1, 2]', { a: 1 }])
	})

	it('consumes non-ASCII whitespace after a dash like /^-\\s+/', () => {
		const result = parse('values:\n  -\u00a0\u00a0[1, 2]\n')
		expect(result.values).toEqual(['[1, 2]'])
	})

	it('parses an array of single-key objects', () => {
		const result = parse(`
			authors:
			  - name: Alice
			  - name: Bob
		`)
		expect(result.authors).toEqual([{ name: 'Alice' }, { name: 'Bob' }])
	})

	it('parses an array of multi-key objects (YAML-compatible)', () => {
		const result = parse(`
			authors:
			  - name: Alice
			    affiliation: MIT
			  - name: Bob
			    affiliation: Stanford
		`)
		expect(result.authors).toEqual([
			{ name: 'Alice', affiliation: 'MIT' },
			{ name: 'Bob',   affiliation: 'Stanford' },
		])
	})

	it('multi-key array objects support type coercion on continuation lines', () => {
		const result = parse(`
			items:
			  - label: Widget
			    count: 42
			    active: true
		`)
		expect(result.items).toEqual([{ label: 'Widget', count: 42, active: true }])
	})

	it('bare dash with no value becomes null in the array', () => {
		const result = parse(`
			values:
			  -
			  - hello
		`)
		expect(result.values).toEqual([null, 'hello'])
	})

	it('array item with a nested map value', () => {
		const result = parse(`
			authors:
			  - name: Alice
			    social:
			      twitter: alice
			  - name: Bob
		`)
		expect(result.authors).toEqual([
			{ name: 'Alice', social: { twitter: 'alice' } },
			{ name: 'Bob' },
		])
	})

	it('a nested block sequence (array-in-array) becomes a single null item, non-strict (Core §7.2)', () => {
		const result = parse('a:\n  - - 1\n    - 2\n  - 3\n')
		// The entire inner sequence is consumed and represented by one null;
		// its own lines are never reinterpreted as siblings of the outer list.
		expect(result.a).toEqual([null, 3])
	})

	it('throws on a nested block sequence in strict mode', () => {
		expect(() => parse('a:\n  - - 1\n    - 2\n  - 3\n', { strict: true })).toThrow('Lima')
	})
})

describe('maps', () => {
	it('uses the full trimStart whitespace set for indentation', () => {
		const result = parse('a:\n  b: 1\n\u00a0\u00a0c: 2\n')
		expect(result.a).toEqual({ b: 1, c: 2 })
	})

	it('matches trimStart indentation for every ECMAScript whitespace code point', () => {
		const whitespace = [
			// TAB and CR are intentionally absent: Core normalization rewrites
			// them before block indentation is measured.
			0x000b, 0x000c, 0x0020, 0x00a0, 0x1680,
			0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
			0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
			0x205f, 0x3000, 0xfeff,
		]
		for (const codePoint of whitespace) {
			const ws = String.fromCodePoint(codePoint)
			const result = parse(`a:\n  b: 1\n${ws}${ws}c: 2\n`)
			expect(result.a).toEqual({ b: 1, c: 2 })
		}
	})

	it('does not silently drop a mapping after Unicode-indented blank lines', () => {
		const result = parse('a:\n  b: 1\n\u00a0\u00a0\n  c: 2\n')
		expect(result.a).toEqual({ b: 1, c: 2 })
	})

	it('parses a key-value map', () => {
		const result = parse(`
			author:
			  name: Alice
			  email: alice@example.com
		`)
		expect(result.author).toEqual({ name: 'Alice', email: 'alice@example.com' })
	})

	it('coerces types in map values', () => {
		const result = parse(`
			stats:
			  count: 42
			  active: true
		`)
		expect(result.stats).toEqual({ count: 42, active: true })
	})

	it('parses two-level nesting (map in map)', () => {
		const result = parse(`
			params:
			  social:
			    twitter: alice
			    github: alice-dev
		`)
		expect(result.params).toEqual({ social: { twitter: 'alice', github: 'alice-dev' } })
	})

	it('parses three-level nesting', () => {
		const result = parse(`
			a:
			  b:
			    c: deep value
		`)
		expect(result.a).toEqual({ b: { c: 'deep value' } })
	})

	it('mixes inline values and nested maps in the same block', () => {
		const result = parse(`
			params:
			  title: Hello
			  social:
			    twitter: alice
			  weight: 1
		`)
		expect(result.params).toEqual({ title: 'Hello', social: { twitter: 'alice' }, weight: 1 })
	})

	it('nested map key with no deeper content becomes null', () => {
		const result = parse(`
			params:
			  empty:
			  title: Hello
		`)
		expect(result.params).toEqual({ empty: null, title: 'Hello' })
	})

	it('trailing whitespace after parent key colon is ignored (YAML-compatible)', () => {
		const result = parse('params:  \n  co: c/o Block\n  city: Fellbach\n')
		expect(result.params).toEqual({ co: 'c/o Block', city: 'Fellbach' })
	})

	it('trailing whitespace works at arbitrary nesting depth', () => {
		const result = parse(`
			person:
			  address:
			    street: Musterstr. 1
			    city: Berlin
			  email: test@example.com
		`)
		expect(result.person).toEqual({
			address: { street: 'Musterstr. 1', city: 'Berlin' },
			email: 'test@example.com',
		})
	})
})

describe('key syntax', () => {
	it('accepts camelCase keys', () => {
		expect(parse('firstName: Alice')).toEqual({ firstName: 'Alice' })
	})

	it('accepts snake_case keys', () => {
		expect(parse('first_name: Alice')).toEqual({ first_name: 'Alice' })
	})

	it('accepts kebab-case keys', () => {
		expect(parse('first-name: Alice')).toEqual({ 'first-name': 'Alice' })
	})

	it('accepts keys starting with underscore', () => {
		expect(parse('_draft: true')).toEqual({ _draft: true })
	})

	it('accepts keys with a digit after the first character', () => {
		expect(parse('h1: Heading')).toEqual({ h1: 'Heading' })
	})

	it('accepts keys starting with a digit', () => {
		expect(parse('1st: First')).toEqual({ '1st': 'First' })
		expect(parse('42: value')).toEqual({ '42': 'value' })
		expect(parse('123abc: yes')).toEqual({ '123abc': 'yes' })
	})

	it('accepts uppercase keys', () => {
		expect(parse('Title: Hello')).toEqual({ Title: 'Hello' })
	})

	it('accepts ALL_CAPS keys', () => {
		expect(parse('BASE_URL: https://example.com')).toEqual({ BASE_URL: 'https://example.com' })
	})

	it('accepts namespaced keys with colon (e.g. og:title)', () => {
		expect(parse('og:title: Hello World')).toEqual({ 'og:title': 'Hello World' })
	})

	it('accepts multiple colon-separated segments', () => {
		expect(parse('og:image:width: 1200')).toEqual({ 'og:image:width': 1200 })
	})

	it('does not confuse og:title with key og and value title: ...', () => {
		const result = parse(`
			og:title: My Article
			og: plain value
		`)
		expect(result['og:title']).toBe('My Article')
		expect(result['og']).toBe('plain value')
	})
})

describe('quoted keys', () => {
	it('single-quoted key with a space', () => {
		expect(parse("'first name': Alice")).toEqual({ 'first name': 'Alice' })
	})

	it('double-quoted key with a space', () => {
		expect(parse('"first name": Alice')).toEqual({ 'first name': 'Alice' })
	})

	it('quoted key alongside unquoted keys', () => {
		const result = parse(`
			title: Hello
			'display name': World
			draft: false
		`)
		expect(result.title).toBe('Hello')
		expect(result['display name']).toBe('World')
		expect(result.draft).toBe(false)
	})

	it('quoted key with a colon inside — colon is not mistaken for separator', () => {
		expect(parse("'key: with colon': value")).toEqual({ 'key: with colon': 'value' })
		expect(parse('"key: with colon": value')).toEqual({ 'key: with colon': 'value' })
	})

	it('single-quoted key spanning a literal newline', () => {
		expect(parse("'a\nb': value")).toEqual({ 'a\nb': 'value' })
	})

	it('double-quoted key with an escaped quote', () => {
		expect(parse('"a\\"b": value')).toEqual({ 'a"b': 'value' })
	})

	it('a backslash directly followed by a real newline inside a double-quoted key is not a valid escape — the key does not match at all', () => {
		// No `s` flag on the underlying grammar means `.` (as in `\.`) never
		// matches a line terminator — a literal `\` + newline inside a
		// double-quoted key breaks the match entirely rather than being
		// treated as an escaped newline.
		expect(parse('"a\\\nb": value')).toEqual({})
	})
})

describe('key with embedded colon, backtracking-dependent cases', () => {
	it('picks the rightmost colon that still allows a valid separator to follow', () => {
		expect(parse('a:b: value')).toEqual({ 'a:b': 'value' })
		expect(parse('a:b:c:d: value')).toEqual({ 'a:b:c:d': 'value' })
	})

	it('a bare key with no separator at all (no trailing space or newline) is not recognized', () => {
		expect(parse('key:')).toEqual({})
	})

	it('two spaces after the colon: separator consumes exactly one, the rest is part of the value', () => {
		expect(parse('key:  value')).toEqual({ key: ' value' })
	})
})

describe('quoted keys, continued', () => {
	it('quoted key with block value (array)', () => {
		const result = parse(`
			'my tags':
			  - javascript
			  - webdev
		`)
		expect(result['my tags']).toEqual(['javascript', 'webdev'])
	})

	it('quoted key with block value (map)', () => {
		const result = parse(`
			'my author':
			  name: Alice
			  email: alice@example.com
		`)
		expect(result['my author']).toEqual({ name: 'Alice', email: 'alice@example.com' })
	})

	it('quoted key as a nested map entry', () => {
		const result = parse(`
			params:
			  'display name': Alice
			  role: editor
		`)
		expect(result.params).toEqual({ 'display name': 'Alice', role: 'editor' })
	})

	it('quoted key as the first key of a block array object item', () => {
		const result = parse(`
			authors:
			  - 'full name': Alice Doe
			    role: editor
			  - 'full name': Bob Smith
		`)
		expect(result.authors).toEqual([
			{ 'full name': 'Alice Doe', role: 'editor' },
			{ 'full name': 'Bob Smith' },
		])
	})

	it('quoted key with type-coerced value', () => {
		expect(parse("'my count': 42")).toEqual({ 'my count': 42 })
		expect(typeof parse("'my count': 42")['my count']).toBe('number')
	})

	it('quoted key with empty string value', () => {
		expect(parse("'empty key': ''")).toEqual({ 'empty key': '' })
	})

	it('quoted key — empty content becomes null (block value)', () => {
		const result = parse(`
			'no value':
			title: Hello
		`)
		expect(result['no value']).toBeNull()
		expect(result.title).toBe('Hello')
	})

	it('empty string key is preserved — not skipped', () => {
		expect(parse("'': value")).toEqual({ '': 'value' })
	})

	it('double-quoted key decodes backslash escape sequences', () => {
		expect(parse('"back\\\\slash": value')).toEqual({ 'back\\slash': 'value' })
		expect(parse('"tab\\there": x')).toEqual({ 'tab\there': 'x' })
	})

	it('double-quoted key containing an escaped quote is still recognized as a key', () => {
		// A naive [^"]* key regex stops at the first *escaped* quote too,
		// failing to recognize the key at all (empty result). The key
		// content decodes \" the same as a double-quoted string value.
		expect(parse('"say \\"hi\\"": value')).toEqual({ 'say "hi"': 'value' })
	})

	it('non-strict: a space between a quoted key\'s closing quote and the colon is skipped as an unrecognized line', () => {
		expect(parse('"first name" : Alice')).toEqual({})
	})

	it('strict: a space between a quoted key\'s closing quote and the colon throws', () => {
		expect(() => parse('"first name" : Alice', { strict: true })).toThrow('Lima')
		expect(() => parse("'first name' : Alice", { strict: true })).toThrow('Lima')
	})
})

})
