import { describe, it, expect } from 'bun:test'
import { parse as parseIndex, type ParseOptions } from './index'

/**
 * Strips common leading whitespace from template literals so tests can be
 * indented naturally without confusing the LIMA parser (which requires keys
 * to start at column 0).
 */
const dedent = (str: string): string => {
	const lines = str.split('\n')
	while (lines.length && !lines[0].trim()) lines.shift()
	while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
	const minIndent = lines
		.filter((l) => l.trim().length > 0)
		.reduce((min, l) => Math.min(min, l.match(/^(\s*)/)?.[1].length ?? 0), Infinity)
	return lines.map((l) => l.slice(minIndent)).join('\n')
}

for (const { name, impl: limaParser } of [
	{ name: 'index',     impl: parseIndex },
]) {
	const parse = (str: string, options?: ParseOptions) => limaParser(dedent(str), options)

describe(name, () => {

// ─── Edge Cases ────────────────────────────────────────────────────────────────

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

// ─── Input Normalization ───────────────────────────────────────────────────────

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

// ─── Strings ───────────────────────────────────────────────────────────────────

describe('strings', () => {
	it('parses a single-line string', () => {
		expect(parse('title: Hello World')).toEqual({ title: 'Hello World' })
	})

	it('parses multiple keys', () => {
		const result = parse(`
			title: Hello
			author: Alice
		`)
		expect(result).toMatchObject({ title: 'Hello', author: 'Alice' })
	})

	it('strips inline comments from single-line values', () => {
		const result = parse('title: Hello World  # this is a comment')
		expect(result.title).toBe('Hello World')
	})

	it('strips # at the start of a value — result is null (empty value)', () => {
		const result = parse('note: # this whole value is a comment')
		expect(result.note).toBeNull()
	})

	it('keeps \\# as a literal # (escaped)', () => {
		const result = parse('tag: \\# not a comment')
		expect(result.tag).toBe('# not a comment')
	})

	it('an inline value never implicitly continues onto the next line (Core §6.1.5)', () => {
		// Core §6.1.5: "Multi-line strings require an explicit `|` marker on
		// the first line." An indented line with no key of its own, following
		// an inline (`: `) value, is not part of that value — it is
		// unrelated top-level content, silently skipped per §4. The legacy
		// parser used to implicitly merge such lines into the value; that is
		// not frozen-spec behavior.
		const result = parse(`
			description: First line.
			  Second line.
		`)
		expect(result.description).toBe('First line.')
	})

	it('supports | as explicit block scalar — trims all lines equally', () => {
		const result = parse(`
			description: |
			  First line.
			  Second line.
		`)
		expect(result.description).toBe('First line.\nSecond line.')
	})

	it('supports > as folded block scalar — newlines become spaces', () => {
		const result = parse(`
			description: >
			  This is a long sentence that
			  continues here as one line.
		`)
		expect(result.description).toBe('This is a long sentence that continues here as one line.')
	})

	it('> and | produce the same result for single-line content', () => {
		const pipe   = parse('desc: |\n  Hello world')
		const folded = parse('desc: >\n  Hello world')
		expect(folded.desc).toBe(pipe.desc)
	})

	it('attaches a line beginning with ^^ to the preceding line (Core §6.1.6)', () => {
		// The continuation marker leads the line it attaches, not trails the
		// line it attaches to — Core 1.0 changed this from the older
		// trailing-^^ convention.
		const result = parse(`
			description: |
			  This is a very long sentence that
			  ^^continues on the next line as one.
			  And this is a new line.
		`)
		expect(result.description).toBe(
			'This is a very long sentence that continues on the next line as one.\nAnd this is a new line.'
		)
	})

	it('^^ on the first line is ignored — content is kept, marker stripped', () => {
		const result = parse(`
			description: |
			  ^^First line.
			  Second line.
		`)
		// ^^ on line 0 has nothing to append to — marker stripped, content kept
		expect(result.description).toBe('First line.\nSecond line.')
	})

	it('^^ alone on a line is dropped without adding trailing space', () => {
		const result = parse(`
			description: |
			  First line.
			  ^^
			  Second line.
		`)
		// bare ^^ has no content to contribute — previous line must not gain a trailing space
		expect(result.description).toBe('First line.\nSecond line.')
	})

	it('^^ has no special meaning outside a | block', () => {
		const result = parse(`
			description: >
			  This line ends with ^^
			  and this is the next one.
		`)
		expect(result.description).toBe('This line ends with ^^ and this is the next one.')
	})

	it('preserves an internal blank line inside a | block scalar as an empty string (Core §6.1.5)', () => {
		const result = parse('description: |\n  Line one.\n\n  Line two.\n')
		expect(result.description).toBe('Line one.\n\nLine two.')
	})

	it('strips trailing blank lines at the end of a | block scalar but keeps internal ones', () => {
		const result = parse('description: |\n  Line one.\n\n\nnext: value\n')
		expect(result.description).toBe('Line one.')
		expect(result.next).toBe('value')
	})

	it('indented freetext with no | marker and no colon yields null in non-strict mode (Core §6.1.5/§10.1)', () => {
		expect(parse('value:\n  freetext\n')).toEqual({ value: null })
	})

	it('indented freetext with no | marker and no colon throws in strict mode', () => {
		expect(() => parse('value:\n  freetext\n', { strict: true })).toThrow('LIMA')
	})

	it('# in an unquoted URL is treated as a comment', () => {
		expect(parse('link: https://example.com/page#section')).toEqual({ link: 'https://example.com/page' })
	})

	it('# inside a quoted string is preserved — not treated as a comment', () => {
		expect(parse('link: "https://example.com/page#section"')).toEqual({ link: 'https://example.com/page#section' })
		expect(parse("link: 'https://example.com/page#section'")).toEqual({ link: 'https://example.com/page#section' })
	})

	it('quoted string with # followed by an actual comment', () => {
		expect(parse('link: "https://example.com/page#section" # comment')).toEqual({ link: 'https://example.com/page#section' })
	})

	it('\\# in an unquoted value is preserved as a literal #', () => {
		expect(parse('link: https://example.com/page\\#section')).toEqual({ link: 'https://example.com/page#section' })
	})
})

// ─── Quoted Strings ────────────────────────────────────────────────────────────

describe('quoted strings', () => {
	it('strips double quotes from a top-level value', () => {
		expect(parse('title: "Hello, World!"')).toEqual({ title: 'Hello, World!' })
	})

	it('strips single quotes from a top-level value', () => {
		expect(parse("title: 'Hello, World!'")).toEqual({ title: 'Hello, World!' })
	})

	it('keeps quoted number as string — no type coercion', () => {
		expect(parse('count: "42"')).toEqual({ count: '42' })
		expect(typeof parse('count: "42"').count).toBe('string')
	})

	it('keeps quoted boolean as string — no type coercion', () => {
		expect(parse('flag: "true"')).toEqual({ flag: 'true' })
	})

	it('keeps quoted null as string — no type coercion', () => {
		expect(parse('field: "null"')).toEqual({ field: 'null' })
	})

	it('strips quotes in a block map value', () => {
		const result = parse(`
			author:
			  name: "Alice Doe"
			  role: 'editor'
		`)
		expect(result.author).toEqual({ name: 'Alice Doe', role: 'editor' })
	})

	it('strips quotes in a block array item value', () => {
		const result = parse(`
			authors:
			  - name: "Alice Doe"
			  - name: 'Bob'
		`)
		expect(result.authors).toEqual([{ name: 'Alice Doe' }, { name: 'Bob' }])
	})

	it('strips quotes in a plain block array scalar', () => {
		const result = parse(`
			tags:
			  - "hello world"
			  - 'foo bar'
			  - plain
		`)
		expect(result.tags).toEqual(['hello world', 'foo bar', 'plain'])
	})

	it('title with colon stays intact when quoted', () => {
		expect(parse('title: "YAML: A Primer"')).toEqual({ title: 'YAML: A Primer' })
	})

	it('unescapes \\" in a top-level double-quoted scalar', () => {
		expect(parse('title: "He said \\"Hello\\""')).toEqual({ title: 'He said "Hello"' })
	})

	it('unescapes \\\' in a top-level single-quoted scalar', () => {
		expect(parse("title: 'it\\'s fine'")).toEqual({ title: "it's fine" })
	})

	it('decodes \\n in double-quoted string to real newline', () => {
		expect(parse('desc: "line 1\\nline 2"')).toEqual({ desc: 'line 1\nline 2' })
	})

	it('decodes \\t in double-quoted string to real tab', () => {
		expect(parse('code: "a\\tb"')).toEqual({ code: 'a\tb' })
	})

	it('decodes \\uXXXX in double-quoted string to Unicode character', () => {
		expect(parse('sym: "\\u00e9"')).toEqual({ sym: 'é' })
		expect(parse('sym: "caf\\u00e9"')).toEqual({ sym: 'café' })
	})

	it('decodes \\xXX in double-quoted string', () => {
		expect(parse('sym: "\\x41"')).toEqual({ sym: 'A' })
	})

	it('decodes \\UXXXXXXXX (8-hex supplementary codepoint) in double-quoted string', () => {
		expect(parse('emoji: "\\U0001F600"')).toEqual({ emoji: '😀' })
	})

	it('treats \\0 as an unknown escape, not a null character (Core Appendix A)', () => {
		expect(parse('v: "a\\0b"')).toEqual({ v: 'a\\0b' })
		expect(() => parse('v: "a\\0b"', { strict: true })).toThrow('LIMA')
	})

	it('leaves an out-of-range \\U codepoint intact instead of throwing a raw RangeError', () => {
		// String.fromCodePoint throws natively for values beyond U+10FFFF —
		// this must surface as the normal invalid-escape fallback/throw, not
		// an uncaught native error.
		expect(parse('v: "a\\U00110000b"')).toEqual({ v: 'a\\U00110000b' })
		expect(() => parse('v: "a\\U00110000b"', { strict: true })).toThrow('LIMA')
	})

	it('leaves a \\uXXXX UTF-16 surrogate (U+D800–U+DFFF) intact instead of decoding it', () => {
		expect(parse('v: "a\\ud800b"')).toEqual({ v: 'a\\ud800b' })
		expect(() => parse('v: "a\\ud800b"', { strict: true })).toThrow('LIMA')
	})

	it('does NOT decode \\n in single-quoted string — backslash is literal', () => {
		expect(parse("desc: 'line 1\\nline 2'")).toEqual({ desc: 'line 1\\nline 2' })
	})

	it('decodes escape sequences in double-quoted flow sequence items', () => {
		expect(parse('lines: ["a\\nb", "c\\td"]')).toEqual({ lines: ['a\nb', 'c\td'] })
	})

	it('decodes escape sequences in double-quoted flow mapping values', () => {
		expect(parse('meta: {title: "a\\nb"}')).toEqual({ meta: { title: 'a\nb' } })
	})

	it('decodes escape sequences in double-quoted block array items', () => {
		const result = parse(`
			lines:
			  - "a\\nb"
			  - "c\\td"
		`)
		expect(result.lines).toEqual(['a\nb', 'c\td'])
	})
})

// ─── Type Coercion ─────────────────────────────────────────────────────────────

describe('type coercion', () => {
	it('parses true as boolean', () => {
		expect(parse('draft: true')).toEqual({ draft: true })
	})

	it('parses false as boolean', () => {
		expect(parse('draft: false')).toEqual({ draft: false })
	})

	it('boolean coercion is case-sensitive (Core §6.3) — only lowercase true/false qualify', () => {
		expect(parse('a: True\nb: TRUE\nc: yes\nd: no\n')).toEqual({
			a: 'True', b: 'TRUE', c: 'yes', d: 'no',
		})
	})

	it('parses integers as number', () => {
		expect(parse('count: 42')).toEqual({ count: 42 })
	})

	it('parses floats as number', () => {
		expect(parse('rating: 3.14')).toEqual({ rating: 3.14 })
	})

	it('parses ISO date strings as Date (UTC midnight)', () => {
		const result = parse('published: 2024-03-01')
		expect(result.published).toBeInstanceOf(Date)
		expect((result.published as Date).toISOString()).toBe('2024-03-01T00:00:00.000Z')
	})

	it('parses ISO datetime strings as UTC', () => {
		const result = parse('published: 2024-10-10T09:00:00')
		expect(result.published).toBeInstanceOf(Date)
		expect((result.published as Date).getUTCHours()).toBe(9)
	})

	it('keeps email addresses as strings (contains @)', () => {
		const result = parse('email: alice@example.com')
		expect(result.email).toBe('alice@example.com')
		expect(typeof result.email).toBe('string')
	})

	it('keeps plain strings as strings', () => {
		expect(parse('slug: my-article')).toEqual({ slug: 'my-article' })
	})

	it('parses scientific notation as number', () => {
		expect(parse('weight: 1e10')).toEqual({ weight: 1e10 })
		expect(typeof parse('weight: 1e10').weight).toBe('number')
	})

	it('keeps "Infinity" as string — not a finite number', () => {
		expect(parse('val: Infinity')).toEqual({ val: 'Infinity' })
		expect(typeof parse('val: Infinity').val).toBe('string')
	})

	it('parses negative integers as number', () => {
		expect(parse('weight: -1')).toEqual({ weight: -1 })
	})

	it('parses negative floats as number', () => {
		expect(parse('temp: -3.14')).toEqual({ temp: -3.14 })
	})

	it('keeps version strings as strings (date-like but not a date)', () => {
		expect(parse('version: 1.2.3')).toEqual({ version: '1.2.3' })
	})

	it('keeps hex literals as strings — not converted to number (YAML 1.2 compatible)', () => {
		expect(parse('color: 0xFF0000')).toEqual({ color: '0xFF0000' })
		expect(typeof parse('color: 0xFF0000').color).toBe('string')
		expect(parse('value: 0XFF')).toEqual({ value: '0XFF' })
	})

	it('keeps octal literals as strings — not converted to number (YAML 1.2 compatible)', () => {
		expect(parse('perm: 0o755')).toEqual({ perm: '0o755' })
		expect(typeof parse('perm: 0o755').perm).toBe('string')
		expect(parse('perm: 0O644')).toEqual({ perm: '0O644' })
	})

	it('keeps binary literals as strings — not converted to number (YAML 1.2 compatible)', () => {
		expect(parse('flags: 0b1010')).toEqual({ flags: '0b1010' })
		expect(typeof parse('flags: 0b1010').flags).toBe('string')
		expect(parse('flags: 0B1111')).toEqual({ flags: '0B1111' })
	})

	it('parses leading decimal point as number (JSON5-compatible shorthand)', () => {
		expect(parse('ratio: .5')).toEqual({ ratio: 0.5 })
		expect(typeof parse('ratio: .5').ratio).toBe('number')
		expect(parse('neg: -.5')).toEqual({ neg: -0.5 })
	})

	it('rejects a non-zero leading zero (Core §6.4.1 grammar) — remains a string', () => {
		expect(parse('v: 01')).toEqual({ v: '01' })
		expect(parse('v: 007')).toEqual({ v: '007' })
	})

	it('rejects a trailing decimal point with no digits — remains a string', () => {
		expect(parse('v: 1.')).toEqual({ v: '1.' })
	})

	it('rejects an explicit plus sign — remains a string', () => {
		expect(parse('v: +42')).toEqual({ v: '+42' })
	})

	it('accepts the safe-integer boundary values (±(2^53-1)) as numbers', () => {
		expect(parse('v: 9007199254740991')).toEqual({ v: 9007199254740991 })
		expect(parse('v: -9007199254740991')).toEqual({ v: -9007199254740991 })
	})

	it('falls back to string for an integer outside the safe-integer range', () => {
		const result = parse('v: 9007199254740993')
		expect(result.v).toBe('9007199254740993')
		expect(typeof result.v).toBe('string')
	})

	it('normalizes -0 and -0.0 to positive zero (Core §6.4.2)', () => {
		expect(Object.is(parse('v: -0').v, -0)).toBe(false)
		expect(parse('v: -0').v).toBe(0)
		expect(Object.is(parse('v: -0.0').v, -0)).toBe(false)
		expect(parse('v: -0.0').v).toBe(0)
	})

	it('falls back to string on float overflow to a non-finite value in non-strict mode', () => {
		const result = parse('v: 1e400')
		expect(result.v).toBe('1e400')
		expect(typeof result.v).toBe('string')
	})

	it('throws on float overflow to a non-finite value in strict mode', () => {
		expect(() => parse('v: 1e400', { strict: true })).toThrow('LIMA')
	})

	it('falls back to string when a non-zero float underflows to zero in non-strict mode', () => {
		const result = parse('v: 1e-400')
		expect(result.v).toBe('1e-400')
		expect(typeof result.v).toBe('string')
	})

	it('throws when a non-zero float underflows to zero in strict mode', () => {
		expect(() => parse('v: 1e-400', { strict: true })).toThrow('LIMA')
	})

	it('accepts a non-zero subnormal float as a number in both modes', () => {
		expect(parse('v: 5e-320')).toEqual({ v: 5e-320 })
		expect(parse('v: 5e-320', { strict: true })).toEqual({ v: 5e-320 })
	})
})

// ─── Multi-line edge cases ─────────────────────────────────────────────────────

describe('multi-line edge cases', () => {
	/**
	 * The key-length cap: trimIndent() never removes more than keyLen + 2 spaces.
	 * If the pipe-block content is indented deeper than the key column, the excess
	 * spaces are preserved in the parsed value.
	 *
	 * Here 'key' (3 chars) + 2 = cap of 5. Content is indented 8 spaces.
	 * → 8 - 5 = 3 spaces remain on each line.
	 */
	it('pipe block: preserves indentation beyond the key-length cap', () => {
		const result = parse(`
			key: |
			        line1
			        line2
		`)
		// 'key' = 3 chars, cap = 5. Content indent = 8. Remaining = 3 spaces.
		expect(result.key).toBe('   line1\n   line2')
	})

	/**
	 * Core §6.1.5 requires an explicit `|` marker for a multi-line string.
	 * An inline value's indented follow-on lines are not part of it (see
	 * the "an inline value never implicitly continues" test above) — only
	 * the first line is ever the value.
	 */
	it('an inline value takes only its first line, even with further indented lines', () => {
		const result = parse(`
			description: first line
			  second line
			  third line
		`)
		expect(result.description).toBe('first line')
	})

	it('pipe block with uniform indentation: all lines trimmed equally', () => {
		const result = parse(`
			text: |
			  alpha
			  beta
			  gamma
		`)
		expect(result.text).toBe('alpha\nbeta\ngamma')
	})
})

// ─── Arrays ────────────────────────────────────────────────────────────────────

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
		expect(() => parse('a:\n  - - 1\n    - 2\n  - 3\n', { strict: true })).toThrow('LIMA')
	})
})

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
		expect(() => parse('tags: [unclosed', { strict: true })).toThrow('LIMA')
	})

	it('drops a trailing comma entirely in non-strict mode — not a trailing null item', () => {
		expect(parse('tags: [a, b,]')).toEqual({ tags: ['a', 'b'] })
	})

	it('leading/consecutive commas become null items in non-strict mode', () => {
		expect(parse('tags: [, a,, b]')).toEqual({ tags: [null, 'a', null, 'b'] })
	})

	it('throws on an empty flow sequence element in strict mode', () => {
		expect(() => parse('tags: [, a]', { strict: true })).toThrow('LIMA')
	})

	it('a flow sequence may contain flow mappings one level deep', () => {
		const result = parse('menu: [{name: Home, url: /}, {name: About, url: /about}]')
		expect(result.menu).toEqual([
			{ name: 'Home', url: '/' },
			{ name: 'About', url: '/about' },
		])
	})

	it('throws in both modes on a directly nested flow sequence (Core §7.4)', () => {
		expect(() => parse('matrix: [[1, 2], [3, 4]]')).toThrow('LIMA')
		expect(() => parse('matrix: [[1, 2], [3, 4]]', { strict: true })).toThrow('LIMA')
	})

	it('throws in both modes on a flow sequence nested via an intermediate flow mapping (depth 2)', () => {
		expect(() => parse('a: [{key: [1,2]}]')).toThrow('LIMA')
		expect(() => parse('a: [{key: [1,2]}]', { strict: true })).toThrow('LIMA')
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

// ─── Maps ──────────────────────────────────────────────────────────────────────

describe('maps', () => {
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
		expect(() => parse('meta: {key: val', { strict: true })).toThrow('LIMA')
	})

	it('drops a trailing comma entirely in non-strict mode — keeps the preceding entries', () => {
		expect(parse('meta: {a: 1, b: 2,}')).toEqual({ meta: { a: 1, b: 2 } })
	})

	it('skips a leading comma in non-strict mode — keeps the following entries', () => {
		expect(parse('meta: {, a: 1}')).toEqual({ meta: { a: 1 } })
	})

	it('throws on an empty flow mapping element in strict mode', () => {
		expect(() => parse('meta: {, a: 1}', { strict: true })).toThrow('LIMA')
	})

	it('throws in both modes when a flow mapping value is itself a nested flow mapping (Core §7.5)', () => {
		expect(() => parse('meta: {a: {b: 1}}')).toThrow('LIMA')
		expect(() => parse('meta: {a: {b: 1}}', { strict: true })).toThrow('LIMA')
	})

	it('throws in both modes when a flow mapping value is a flow sequence', () => {
		expect(() => parse('meta: {a: [1, 2]}')).toThrow('LIMA')
		expect(() => parse('meta: {a: [1, 2]}', { strict: true })).toThrow('LIMA')
	})
})

// ─── References ────────────────────────────────────────────────────────────────

describe('references', () => {
	it('resolves ($key) to a preceding property', () => {
		const result = parse(`
			firstName: Alice
			fullName: ($firstName)
		`)
		expect(result.fullName).toBe('Alice')
	})

	it('resolves (%key) to a provided partial', () => {
		const result = parse('author: (%defaultAuthor)', {
			partials: { defaultAuthor: 'Alice' },
		})
		expect(result.author).toBe('Alice')
	})

	it('resolves a document reference with a dotted path through nested mappings', () => {
		const result = parse(`
			site:
			  default:
			    claim: Great blog
			result: ($site.default.claim)
		`)
		expect(result.result).toBe('Great blog')
	})

	it('resolves a partial reference with a literal slash in the key (namespacing, not traversal)', () => {
		const result = parse('a: (%persons/alice)', {
			partials: { 'persons/alice': 'Alice' },
		})
		expect(result.a).toBe('Alice')
	})

	it('does not treat a dotted partial path as valid — partials are flat, not traversable (References Appendix)', () => {
		const result = parse('a: (%foo.bar)', {
			partials: { 'foo.bar': 'nope', foo: { bar: 'nested' } },
		})
		expect(result.a).toBe('(%foo.bar)')
	})

	it('does not resolve a bare %key without parentheses — the shorthand was removed (References Appendix)', () => {
		const person = { name: 'Alice', url: 'https://alice.example' }
		const result = parse('author: %persons/alice', {
			partials: { 'persons/alice': person },
		})
		expect(result.author).toBe('%persons/alice')
	})

	it('does not treat %key with spaces as a partial reference', () => {
		const result = parse('note: 100% done', { partials: { done: 'nope' } })
		expect(result.note).toBe('100% done')
	})

	it('a bare %key with no matching partial is unaffected either way, since bare %key is never a reference', () => {
		const result = parse('author: %unknown', { partials: {} })
		expect(result.author).toBe('%unknown')
	})

	it('throws in both modes when an array-valued reference is inserted as a sequence item — array spreading was removed (References Appendix)', () => {
		const doc = `
			keywords:
			  - (%baseTags)
			  - extra
		`
		const opts = { partials: { baseTags: ['javascript', 'webdev'] } }
		expect(() => parse(doc, opts)).toThrow('LIMA')
		expect(() => parse(doc, { ...opts, strict: true })).toThrow('LIMA')
	})

	it('interpolates references embedded in a string', () => {
		const result = parse(`
			name: Alice
			greeting: Hello ($name)!
		`)
		expect(result.greeting).toBe('Hello Alice!')
	})

	it('interpolates multiple references in one string', () => {
		const result = parse(`
			first: John
			last: Doe
			full: ($first) ($last)
		`)
		expect(result.full).toBe('John Doe')
	})

	it('interpolates a ($key) and a (%key) in the same string', () => {
		const result = parse(
			`
			tag: JS
			label: ($tag) by (%author)
		`,
			{ partials: { author: 'Alice' } },
		)
		expect(result.label).toBe('JS by Alice')
	})

	it('leaves unresolvable references unchanged in interpolated strings', () => {
		const result = parse(`
			greeting: Hello ($unknown)!
		`)
		expect(result.greeting).toBe('Hello ($unknown)!')
	})

	it('self-reference stays unchanged — key not yet defined when value is resolved', () => {
		expect(parse('a: ($a)')).toEqual({ a: '($a)' })
	})

	it('forward reference is resolved — referenced key appears later in the document', () => {
		const result = parse(`
			b: ($a)
			a: hello
		`)
		expect(result.b).toBe('hello')
		expect(result.a).toBe('hello')
	})

	it('forward reference preserves original type (number)', () => {
		const result = parse(`
			doubled: ($count)
			count: 42
		`)
		expect(result.doubled).toBe(42)
		expect(typeof result.doubled).toBe('number')
	})

	it('forward reference inside an array is resolved', () => {
		const result = parse(`
			tags:
			  - ($base)
			  - extra
			base: javascript
		`)
		expect(result.tags).toEqual(['javascript', 'extra'])
	})

	it('resolves chained references ($a)($b) via string interpolation', () => {
		const result = parse(`
			a: foo
			b: bar
			combined: ($a)($b)
		`)
		expect(result.combined).toBe('foobar')
	})
})

// ─── Dotted-path references ────────────────────────────────────────────────────

describe('dotted-path references', () => {
	it('resolves ($a.b) as a pure reference preserving original type', () => {
		const result = parse(`
			site:
			  default:
			    count: 42
			total: ($site.default.count)
		`)
		expect(result.total).toBe(42)
		expect(typeof result.total).toBe('number')
	})

	it('interpolates ($a.b.c) embedded in a string', () => {
		const result = parse(`
			site:
			  default:
			    claim: Software, Tools, AI
			tagline: Ein Blog über ($site.default.claim).
		`)
		expect(result.tagline).toBe('Ein Blog über Software, Tools, AI.')
	})

	it('resolves forward dotted-path reference — key appears later in document', () => {
		const result = parse(`
			tagline: Ein Blog über ($site.default.claim).
			site:
			  default:
			    claim: Software, Tools, AI
		`)
		expect(result.tagline).toBe('Ein Blog über Software, Tools, AI.')
	})

	it('leaves unresolvable dotted path unchanged in interpolated string', () => {
		const result = parse(`
			tagline: Ein Blog über ($site.missing.claim).
		`)
		expect(result.tagline).toBe('Ein Blog über ($site.missing.claim).')
	})

	it('resolves two-level dotted path', () => {
		const result = parse(`
			a:
			  b: hello
			ref: ($a.b)
		`)
		expect(result.ref).toBe('hello')
	})
})

// ─── Quoted reference tokens stay inactive (References §2.3) ──────────────────
// A reference-like token inside a quoted string is always literal — never
// resolved, at any nesting depth, in either mode.

describe('quoted reference tokens', () => {
	it('stays literal at the top level', () => {
		const result = parse(`
			source: 42
			value: "($source)"
		`)
		expect(result.value).toBe('($source)')
	})

	it('stays literal nested inside a block mapping', () => {
		const result = parse(`
			source: 42
			wrapper:
			  value: "($source)"
		`)
		expect((result.wrapper as any).value).toBe('($source)')
	})

	it('stays literal nested inside a block array item', () => {
		const result = parse(`
			source: 42
			list:
			  - "($source)"
		`)
		expect(result.list).toEqual(['($source)'])
	})

	it('stays literal nested inside a flow mapping', () => {
		const result = parse(`
			source: 42
			wrapper: {value: "($source)"}
		`)
		expect((result.wrapper as any).value).toBe('($source)')
	})

	it('stays literal nested inside a flow sequence', () => {
		const result = parse(`
			source: 42
			list: ["($source)", other]
		`)
		expect(result.list).toEqual(['($source)', 'other'])
	})

	it('stays literal for a forward reference (phase 2), not just backward', () => {
		const result = parse(`
			wrapper:
			  value: "($source)"
			source: 42
		`)
		expect((result.wrapper as any).value).toBe('($source)')
	})

	it('does not trigger a strict-mode unresolved-reference error when nested', () => {
		expect(() => parse(`
			wrapper:
			  value: "($source)"
		`, { strict: true })).not.toThrow()
	})

	it('never leaks the internal inactive-value marker to the public result', () => {
		const result = parse(`wrapper:\n  value: "($source)"`)
		const nested = (result.wrapper as any).value
		expect(typeof nested).toBe('string')
		expect(Object.getOwnPropertySymbols(result.wrapper as any)).toHaveLength(0)
	})
})

// ─── Key syntax ────────────────────────────────────────────────────────────────

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

// ─── Quoted keys (spaces and other special characters) ────────────────────────

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
		expect(() => parse('"first name" : Alice', { strict: true })).toThrow('LIMA')
		expect(() => parse("'first name' : Alice", { strict: true })).toThrow('LIMA')
	})
})

// ─── Null type ─────────────────────────────────────────────────────────────────

describe('null type', () => {
	it('parses "null" as null', () => {
		expect(parse('field: null')).toEqual({ field: null })
	})

	it('parses "~" as null (YAML shorthand)', () => {
		expect(parse('field: ~')).toEqual({ field: null })
	})

	it('empty value (key with only whitespace) returns null', () => {
		const result = parse('field: \ntitle: Hello')
		expect(result.field).toBeNull()
		expect(result.title).toBe('Hello')
	})

	it('null is falsy', () => {
		const result = parse('field: null')
		expect(result.field).toBeFalsy()
	})

	it('null in a map value', () => {
		const result = parse(`
			meta:
			  draft: null
			  title: Hello
		`)
		expect(result.meta).toEqual({ draft: null, title: 'Hello' })
	})

	it('null in a block array', () => {
		const result = parse(`
			values:
			  - null
			  - hello
		`)
		expect(result.values).toEqual([null, 'hello'])
	})

	it('top-level key with no value (bare colon) becomes null', () => {
		const result = limaParser('empty:\ntitle: Hello')
		expect(result.empty).toBeNull()
		expect(result.title).toBe('Hello')
	})
})

// ─── Comments ─────────────────────────────────────────────────────────────────

describe('comments', () => {
	it('skips a top-level comment line', () => {
		const result = parse('# this is a comment\ntitle: Hello')
		expect(result).toEqual({ title: 'Hello' })
	})

	it('does not add # comment line as a key', () => {
		const result = parse('# key: value\ntitle: Hello')
		expect(result).toEqual({ title: 'Hello' })
		expect(Object.keys(result)).not.toContain('# key')
	})

	it('skips comment lines at any indentation level in a map', () => {
		const result = parse(`
			site:
			  # base: /test
			  language: de
		`)
		expect(result.site).toEqual({ language: 'de' })
		expect(Object.keys(result.site)).not.toContain('# base')
	})

	it('skips comment lines inside a block array', () => {
		const result = parse(`
			tags:
			  # ignored
			  - javascript
			  - webdev
		`)
		expect(result.tags).toEqual(['javascript', 'webdev'])
	})

	it('skips multiple consecutive comment lines', () => {
		const result = parse(`
			# comment 1
			# comment 2
			title: Hello
			# comment 3
			lang: de
		`)
		expect(result).toEqual({ title: 'Hello', lang: 'de' })
	})

	it('inline comment on a value is still stripped', () => {
		const result = parse('title: Hello # inline comment')
		expect(result.title).toBe('Hello')
	})

	it('strips an inline comment on a value inside a nested block mapping (Core §8)', () => {
		const result = parse('author:\n  name: Alice   # comment\n  role: editor\n')
		expect(result.author).toEqual({ name: 'Alice', role: 'editor' })
	})

	it('strips an inline comment on an array-item continuation key value', () => {
		const result = parse('authors:\n  - name: Alice\n    role: editor   # comment\n')
		expect(result.authors).toEqual([{ name: 'Alice', role: 'editor' }])
	})
})

// ─── Dates — UTC parsing ───────────────────────────────────────────────────────

describe('dates — UTC parsing', () => {
	it('applies +HH:MM offset and converts to UTC', () => {
		const result = parse('published: 2026-04-09T16:00+02:00')
		expect(result.published).toBeInstanceOf(Date)
		// 16:00 CET (UTC+2) → 14:00 UTC
		expect((result.published as Date).toISOString()).toBe('2026-04-09T14:00:00.000Z')
	})

	it('applies -HH:MM offset and converts to UTC', () => {
		const result = parse('published: 2026-04-09T16:00-08:00')
		expect(result.published).toBeInstanceOf(Date)
		// 16:00 PST (UTC-8) → next-day 00:00 UTC
		expect((result.published as Date).toISOString()).toBe('2026-04-10T00:00:00.000Z')
	})

	it('keeps Z suffix unchanged — time already UTC', () => {
		const result = parse('published: 2026-04-09T14:33Z')
		expect(result.published).toBeInstanceOf(Date)
		expect((result.published as Date).toISOString()).toBe('2026-04-09T14:33:00.000Z')
	})

	it('parses YYYY/MM/DD HH:MM:SS as UTC (month and day must be two digits)', () => {
		const result = parse('published: 2026/05/21 11:00:32')
		expect(result.published).toBeInstanceOf(Date)
		expect((result.published as Date).toISOString()).toBe('2026-05-21T11:00:32.000Z')
	})

	it('rejects a single-digit month/day in slash format (Core §6.5.1) — remains a string', () => {
		// Unlike the German format, slash format requires exactly two digits.
		expect(parse('published: 2026/5/21').published).toBe('2026/5/21')
	})

	it('parses DD.MM.YYYY HH:MM as UTC', () => {
		const result = parse('published: 10.3.2026 14:33')
		expect(result.published).toBeInstanceOf(Date)
		expect((result.published as Date).toISOString()).toBe('2026-03-10T14:33:00.000Z')
	})

	it('rejects a space-separated ISO datetime (Core §6.5.1: T is required) — remains a string', () => {
		const result = parse('published: 2026-04-09 16:00')
		expect(result.published).toBe('2026-04-09 16:00')
		expect(result.published).not.toBeInstanceOf(Date)
	})

	it('parses pre-epoch dates correctly (before 1970-01-01)', () => {
		const result = parse('landing: 1969-07-20')
		expect(result.landing).toBeInstanceOf(Date)
		expect((result.landing as Date).toISOString()).toBe('1969-07-20T00:00:00.000Z')
	})

	it('invalid date that matches pre-check falls back to string, not Invalid Date', () => {
		const result = parse('date: 2024-99-99')
		expect(result.date).toBe('2024-99-99')
		expect(result.date).not.toBeInstanceOf(Date)
	})

	it('rejects Feb 29 in a non-leap year — remains a string, not silently rolled to March 1 (Core §6.5.2)', () => {
		const result = parse('date: 2023-02-29')
		expect(result.date).toBe('2023-02-29')
		expect(result.date).not.toBeInstanceOf(Date)
	})

	it('accepts Feb 29 in a leap year, including the divisible-by-400 rule', () => {
		expect((parse('date: 2024-02-29').date as Date).toISOString()).toBe('2024-02-29T00:00:00.000Z')
		expect((parse('date: 2000-02-29').date as Date).toISOString()).toBe('2000-02-29T00:00:00.000Z')
	})

	it('rejects a day beyond the month length — remains a string, not silently rolled forward', () => {
		expect(parse('date: 2024-02-30').date).toBe('2024-02-30')
		expect(parse('date: 2024-04-31').date).toBe('2024-04-31')
	})

	it('throws on an invalid calendar date in strict mode', () => {
		expect(() => parse('date: 2024-02-30', { strict: true })).toThrow('LIMA')
	})

	it('rejects an offset minute other than 00 when the offset hour is the ±14:00 boundary', () => {
		const result = parse('date: 2024-03-01T09:00+14:01')
		expect(result.date).toBe('2024-03-01T09:00+14:01')
		expect(result.date).not.toBeInstanceOf(Date)
	})

	it('accepts the ±14:00 offset boundary itself', () => {
		expect((parse('date: 2024-03-01T09:00+14:00').date as Date).toISOString()).toBe('2024-02-29T19:00:00.000Z')
		expect((parse('date: 2024-03-01T09:00-14:00').date as Date).toISOString()).toBe('2024-03-01T23:00:00.000Z')
	})

	it('rejects a UTC Instant that falls outside years 0001-9999 after applying the offset (Core §6.5.3)', () => {
		expect(parse('date: 0001-01-01T00:00+14:00').date).toBe('0001-01-01T00:00+14:00')
		expect(parse('date: 9999-12-31T23:59-14:00').date).toBe('9999-12-31T23:59-14:00')
	})

	it('throws when the UTC Instant falls outside years 0001-9999 in strict mode', () => {
		expect(() => parse('date: 0001-01-01T00:00+14:00', { strict: true })).toThrow('LIMA')
	})
})

// ─── Strict Mode ───────────────────────────────────────────────────────────────

describe('duplicate keys', () => {
	it('last value wins (silent overwrite in non-strict mode)', () => {
		const result = parse(dedent(`
			title: First
			title: Second
		`))
		expect(result.title).toBe('Second')
	})

	it('emits console.warn for duplicate key', () => {
		const warnings: string[] = []
		const orig = console.warn
		console.warn = (msg: string) => warnings.push(msg)
		parse(dedent(`
			title: First
			title: Second
		`))
		console.warn = orig
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain('duplicate key "title"')
		expect(warnings[0]).toContain('at line 2')
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
		const warnings: string[] = []
		const orig = console.warn
		console.warn = (msg: string) => warnings.push(msg)
		const result = parse('author:\n  name: Alice\n  name: Bob')
		console.warn = orig
		expect(result.author).toEqual({ name: 'Bob' })
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain('duplicate key "name"')
		expect(warnings[0]).toContain('at line 3')
	})

	it('throws on a duplicate key in a nested block mapping in strict mode', () => {
		expect(() => parse('author:\n  name: Alice\n  name: Bob', { strict: true })).toThrow(
			'at line 3'
		)
	})

	it('warns and last-value-wins for a duplicate key in a flow mapping', () => {
		const warnings: string[] = []
		const orig = console.warn
		console.warn = (msg: string) => warnings.push(msg)
		const result = parse('author: {name: Alice, name: Bob}')
		console.warn = orig
		expect(result.author).toEqual({ name: 'Bob' })
		expect(warnings).toHaveLength(1)
		expect(warnings[0]).toContain('duplicate key "name"')
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

// ─── Resource limits (Core §9) ─────────────────────────────────────────────────
// All hard errors in both modes — none of these tests use strict: true.

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

	it('accepts nesting exactly at the 16-level limit', () => {
		expect(() => parse(nestedDoc(16))).not.toThrow()
	})

	it('rejects nesting one level deeper than the limit', () => {
		expect(() => parse(nestedDoc(17))).toThrow('LIMA')
	})
})

// ─── Real-world document ───────────────────────────────────────────────────────

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

}) // describe(name)
} // for parsers
