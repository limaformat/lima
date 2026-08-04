import { describe, it, expect } from 'bun:test'
import { forEachParser } from './test-helpers.js'

forEachParser((parse, limaParser) => {

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

	it('an inline value followed by a freetext line is unchanged in strict mode — not on the closed strict-error list (Core §10.1)', () => {
		const result = parse(`
			description: First line.
			  Second line.
		`, { strict: true })
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

	it('> is a plain unquoted string, not a block scalar marker (Core 1.0 excludes >)', () => {
		expect(parse('desc: >')).toEqual({ desc: '>' })
	})

	it('a freetext line after `>` is silently dropped in non-strict mode', () => {
		const result = parse('desc: >\n  Hello\n  World')
		expect(result.desc).toBe('>')
	})

	it('a freetext line after `>` is unchanged in strict mode — not on the closed strict-error list (Core §10.1)', () => {
		const result = parse('desc: >\n  Hello\n  World', { strict: true })
		expect(result.desc).toBe('>')
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
		const result = parse('description: This line ends with ^^')
		expect(result.description).toBe('This line ends with ^^')
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
		expect(Object.keys(result.site as Record<string, unknown>)).not.toContain('# base')
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

})
