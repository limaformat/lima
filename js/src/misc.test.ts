import { describe, it, expect } from 'bun:test'
import { forEachParser } from './test-helpers.js'

forEachParser((parse, limaParser) => {

describe('edge cases', () => {
	it('returns empty object for empty string', () => {
		expect(limaParser('')).toEqual({})
	})

	it('returns empty object when no keys are found', () => {
		expect(parse('just some text without keys')).toEqual({})
	})

	it('handles a single key without trailing newline', () => {
		expect(parse('title: Hello')).toMatchObject({ title: 'Hello' })
	})
})

describe('input normalization', () => {
	it('normalizes CRLF line endings', () => {
		expect(limaParser('title: Hello\r\nauthor: Alice')).toEqual({ title: 'Hello', author: 'Alice' })
	})

	it('normalizes tabs to 2 spaces (block array)', () => {
		expect(limaParser('tags:\n\t- js\n\t- ts')).toEqual({ tags: ['js', 'ts'] })
	})

	it('normalizes tabs to 2 spaces (block map)', () => {
		expect(limaParser('author:\n\tname: Alice')).toEqual({ author: { name: 'Alice' } })
	})

	it('normalizes a standalone CR (not part of CRLF) to LF', () => {
		expect(limaParser('title: Hello\rauthor: Alice')).toEqual({ title: 'Hello', author: 'Alice' })
	})

	it('preserves a tab inside scalar content — only leading indentation tabs are normalized', () => {
		expect(limaParser('value: a\tb')).toEqual({ value: 'a\tb' })
	})

	it('normalizes a tab mixed with leading spaces in indentation', () => {
		expect(limaParser('author:\n  \tname: Alice')).toEqual({ author: { name: 'Alice' } })
	})
})

describe('real-world document', () => {
	it('parses a typical blog post frontmatter', () => {
		const result = parse(`
			title: My First Post
			published: 2024-03-01
			draft: false
			tags:
			  - javascript
			  - webdev
			author:
			  name: Alice
			  email: alice@example.com
		`)

		expect(result).toMatchObject({ title: 'My First Post', draft: false })
		expect(result.published).toBeInstanceOf(Date)
		expect(result.tags).toEqual(['javascript', 'webdev'])
		expect(result.author).toEqual({ name: 'Alice', email: 'alice@example.com' })
	})
})

})
