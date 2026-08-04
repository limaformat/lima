import { describe, it, expect } from 'bun:test'
import { forEachParser } from './test-helpers.js'
import { parseCore } from './core.js'

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

	it('fully strips a blank line consisting only of tabs (tab-expansion + trailing-space-strip interaction)', () => {
		// Regression guard: the tab-expansion pass turns an all-tab line
		// into an all-space line, which the trailing-whitespace-strip pass
		// must still catch — a naive "skip this pass if no tabs/no trailing
		// spaces up front" fastpath could miss whitespace newly created by
		// an earlier pass.
		expect(limaParser('a: 1\n\t\t\nb: 2')).toEqual({ a: 1, b: 2 })
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

// Outside forEachParser — CoreOptions has no `partials` field (Appendix A:
// "partials option in Core API — References Extension only"), so this
// exercises parseCore directly with an options object that bypasses that
// type constraint, the same way an untyped JS caller could. Not
// expressible as a corpus case: the schema's own `api: "core"` cases must
// not set `options.partials` (parseCore has no such option), and the
// runner's core-api branch never forwards `partials` to parseCore at all
// — so a corpus case could only ever prove the runner doesn't forward it,
// not that parseCore itself tolerates an untyped caller passing it. Same
// reasoning as R-032/R-137 in coverage/references.md.
describe('parseCore ignores an unsupported partials option', () => {
	it('produces the identical result with or without it, reference tokens still unresolved', () => {
		const withPartials = parseCore('a: (%p)\n', { partials: { p: 'Alice' } } as never)
		const withoutPartials = parseCore('a: (%p)\n')
		expect(withPartials).toEqual(withoutPartials)
		expect(withPartials.a).toBe('(%p)')
	})

	it('does not throw for it even in strict mode', () => {
		expect(() => parseCore('a: (%p)\n', { strict: true, partials: { p: 'Alice' } } as never)).not.toThrow()
	})
})
