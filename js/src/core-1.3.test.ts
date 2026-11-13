/**
 * Lima Core 1.3: what it reads otherwise than Core 1.2, its errata, and the defects it touches. Each test fails on the
 * Core 1.2 implementation.
 */
import { describe, expect, it } from 'bun:test'
import { outline, parse, parseCore, LimaError } from './index.js'

const strict = { strict: true }

/** The diagnostic `parseCore` throws: code, line and message. */
const failure = (input: string, options = strict): { code: string; line?: number; message: string } => {
	try {
		parseCore(input, options)
	} catch (error) {
		if (!(error instanceof LimaError)) throw error
		return { code: error.code, line: error.line, message: error.message }
	}
	throw new Error(`no error for ${JSON.stringify(input)}`)
}

describe('Core 1.3 §4: a # begins a comment only at the start of a value or after whitespace', () => {
	it('keeps a # after text, in both modes', () => {
		for (const options of [{}, strict]) {
			expect(parseCore('link: https://example.org/x#top', options)).toEqual({ link: 'https://example.org/x#top' })
			expect(parseCore('lang: C#', options)).toEqual({ lang: 'C#' })
		}
	})

	it('counts the whitespace of §1 before a #, but not U+0085', () => {
		expect(parseCore('k: x\u00a0#c\nj: x\ufeff#c')).toEqual({ k: 'x', j: 'x' })
		expect(parseCore('k: x\u0085#c')).toEqual({ k: 'x\u0085#c' })
	})

	it('decides once over a whole flow value, by the character physically before the #', () => {
		expect(parseCore('k: [a,#x]\nj: [#x]')).toEqual({ k: ['a', '#x'], j: ['#x'] })
		expect(parseCore('k: [a, #x]')).toEqual({ k: '[a,' })
		expect(failure('k: [a, #x]')).toMatchObject({ code: 'INVALID_FLOW_SYNTAX', line: 1 })
		expect(parseCore('k: {a: x#y}')).toEqual({ k: { a: 'x#y' } })
	})

	it('still reads \\# as # and a quoted # as text', () => {
		expect(parseCore("k: \\#x\nj: \\\\#x\nq: '#x'\n'#': x")).toEqual({ k: '#x', j: '\\#x', q: '#x', '#': 'x' })
	})

	it('maps every # of a flow value to its source for References token positions', () => {
		// Core 1.2 assumed every # in a decoded flow value came from \#: an internal error here
		expect(parse('a: 42\nb: [a#b,${a}]')).toEqual({ a: 42, b: ['a#b', 42] })
		expect(parse('a: 42\nb: [\\#x,${a}]')).toEqual({ a: 42, b: ['#x', 42] })
		expect(() => parse('b: [a#b, ${missing}]', strict)).toThrow(expect.objectContaining({ column: 10, line: 1 }))
	})

	it('makes a token after a # active, and one before it an interpolation (References 2.1 under Core 1.3)', () => {
		expect(parse('a: 42\nb: ${a}#x')).toEqual({ a: 42, b: '42#x' })
		expect(parse('a: 42\nb: v#${a}')).toEqual({ a: 42, b: 'v#42' })
		expect(parse('a: 42\nb: ${a} #x')).toEqual({ a: 42, b: 42 })
		expect(parse('a: 42\nb: #${a}')).toEqual({ a: 42, b: null })
	})
})

describe('Core 1.3 §4, §7.1: an entry whose value is only a comment is a bare key', () => {
	it('takes the block that follows, at every level', () => {
		expect(parseCore('k: # c\n  a: 1', strict)).toEqual({ k: { a: 1 } })
		expect(parseCore('k: #c\n- x', strict)).toEqual({ k: ['x'] })
		expect(parseCore('m:\n  k: # c\n    a: 1\n  j: #c\n  - x', strict)).toEqual({ m: { k: { a: 1 }, j: ['x'] } })
		expect(parseCore('k:\n  - a: x\n    b: #c\n      c: 1', strict)).toEqual({ k: [{ a: 'x', b: { c: 1 } }] })
		expect(parseCore('k:\n- a: 1\n  b: # c\n    c: 2\n  d: 3', strict)).toEqual({ k: [{ a: 1, b: { c: 2 }, d: 3 }] })
		expect(parseCore('k:\n  - b: # c\n      c: 1', strict)).toEqual({ k: [{ b: { c: 1 } }] })
	})

	it('is null without a block', () => {
		expect(parseCore('k: # c\nj: 1', strict)).toEqual({ k: null, j: 1 })
	})

	it('leaves `- # note` a null item that opens no block', () => {
		expect(parseCore('k:\n  - #c\n    a: 1')).toEqual({ k: [null] })
		expect(failure('k:\n  - #c\n    a: 1')).toMatchObject({ code: 'INVALID_INDENTATION', line: 3 })
	})

	it('does not make `k: null` or `k: \'\'` bare', () => {
		expect(parseCore("k: null\n  a: 1\nj: ''\n  a: 1")).toEqual({ k: null, j: '' })
		expect(failure('k: null\n  a: 1')).toMatchObject({ code: 'INVALID_INDENTATION', line: 2 })
		expect(failure("m:\n  k: ''\n    a: 1")).toMatchObject({ code: 'INVALID_INDENTATION', line: 3 })
	})

	it('reports the key and the comment in the outline as parse reads them', () => {
		const source = 'k: # c\n  a: x#y # d\nj:\t1\n'
		const result = outline(source)
		expect(result.diagnostics).toEqual([])
		expect(result.keys.map((key) => key.path)).toEqual([['k'], ['k', 'a'], ['j']])
		expect(result.comments.map((span) => source.slice(span.start.offset, span.end.offset))).toEqual(['# c', '# d'])
		expect(result.keys[2]!.separator).toEqual({
			start: { line: 3, column: 2, offset: 21 }, end: { line: 3, column: 4, offset: 23 },
		})
	})
})

describe('Core 1.3 §5.1: a tab after the colon separates as a space does', () => {
	it('in every key context', () => {
		expect(parseCore("k:\t1\n'q':\t2\na:b:\t3\nf: {a:\t1}\nm:\n  n:\t4\ns:\n  - o:\t5\n    p:\t6", strict)).toEqual({
			k: 1, q: 2, 'a:b': 3, f: { a: 1 }, m: { n: 4 }, s: [{ o: 5, p: 6 }],
		})
	})

	it('makes a key whose value is a tab alone bare', () => {
		expect(parseCore('k:\t', strict)).toEqual({ k: null })
		expect(parseCore('k:\t\n  a: 1', strict)).toEqual({ k: { a: 1 } })
	})

	it('but other whitespace after the colon makes no separator', () => {
		expect(parseCore('k:\u00a0x')).toEqual({})
		expect(failure('k:\u00a0x')).toMatchObject({ code: 'UNRECOGNIZED_LINE', line: 1 })
	})
})

describe('Core 1.3 §6.1.1: a value starting with &, * or ! is an error in strict mode', () => {
	it('in every value position', () => {
		expect(failure('k: &x')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
		expect(failure('k:\n- *x')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 2 })
		expect(failure('k: [!x]')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
		expect(failure('k: {a: &x}')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
		expect(failure('m:\n  k: !!str 1')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 2 })
	})

	it('is a string in non-strict mode, and quoted or in a | scalar in both', () => {
		expect(parseCore('k: &x\nl: [!x]\nm: {a: &x}')).toEqual({ k: '&x', l: ['!x'], m: { a: '&x' } })
		expect(parseCore("k: '&x'\nl: |\n  &x", strict)).toEqual({ k: '&x', l: '&x' })
	})

	it('names the cure: quote the value', () => {
		expect(failure('k: *new*').message).toBe(
			'Lima: unquoted value starting with "*" at line 1 (YAML reads it as an alias; Lima has no anchors, aliases or tags: quote the value)',
		)
	})
})

describe('Core 1.3 §6.1.6: a YAML block scalar header is an error in strict mode, at its own line', () => {
	it('with or without lines after it', () => {
		for (const header of ['>', '|-', '|+', '|2', '>2-', '>-9', '>+']) {
			expect(failure(`k: ${header}`)).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
			expect(failure(`k: ${header}\n  text`)).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
		}
		expect(failure('k: [>]')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
	})

	it('tests the value after comment removal, the | marker before it', () => {
		expect(failure('k: > #c')).toMatchObject({ code: 'UNSUPPORTED_YAML', line: 1 })
		expect(parseCore('k: > #c')).toEqual({ k: '>' })
		expect(parseCore('a: >#c\nb: > text\nc: >0\nd: >10\ne: |--\nf: >word', strict)).toEqual({
			a: '>#c', b: '> text', c: '>0', d: '>10', e: '|--', f: '>word',
		})
		expect(parseCore('m:\n  a: | # c\n    text')).toEqual({ m: { a: '|' } })
		expect(failure('m:\n  a: | # c\n    text')).toMatchObject({ code: 'INVALID_INDENTATION', line: 3 })
		expect(parseCore('k: |\n  #x\n  ^^y', strict)).toEqual({ k: '#x y' })
	})

	it('is a string in non-strict mode, the lines after it skipped', () => {
		expect(parseCore('k: >\n  text\nj: 1')).toEqual({ k: '>', j: 1 })
	})
})

describe('Core 1.3 §7.5: a flow mapping finds its separator before trimming', () => {
	it('reads {k: } as {k: null}, in both modes', () => {
		for (const options of [{}, strict]) {
			expect(parseCore('a: {k: }\nb: {k:\t}\nc: {x: 1, k: }', options)).toEqual({ a: { k: null }, b: { k: null }, c: { x: 1, k: null } })
		}
	})

	it('finds no separator in {k:}', () => {
		expect(parseCore('a: {k:}')).toEqual({ a: '{k:}' })
		expect(failure('a: {k:}')).toMatchObject({ code: 'INVALID_FLOW_SYNTAX', line: 1 })
	})
})

describe('Errata to Core 1.2', () => {
	it('§4: trims the whitespace of §1 from an inline value', () => {
		expect(parseCore('draft: false\u00a0\nn: 1\u3000 # c', strict)).toEqual({ draft: false, n: 1 })
	})

	it('§3: expands tabs only in the run of spaces and tabs at the start of a U+000A line', () => {
		// Core 1.2's TypeScript read U+2028 as a line start and expanded the tab after it
		expect(parseCore('k: a\u2028\tb')).toEqual({ k: 'a\u2028\tb' })
		expect(parseCore('k: |\n  \u00a0\tx')).toEqual({ k: '\u00a0\tx' })
		expect(parseCore('x: 1 \nk: a \u2028b')).toEqual({ x: 1, k: 'a \u2028b' })
		// a document that starts with an empty line still expands the tabs of the next
		expect(failure('\n\tk: v')).toMatchObject({ code: 'INVALID_INDENTATION', line: 2 })
	})

	it('§3: keeps References token columns after U+2028', () => {
		// a tab after U+2028 added a line to Core 1.2's TypeScript tab count, and moved every later token
		expect(() => parse('x: a\u2028\tb\ny:\n\t\tc: ${nope}', strict)).toThrow(expect.objectContaining({ line: 3, column: 6 }))
	})

	it('Appendix D: a single-quoted key admits no escape', () => {
		expect(parseCore("'a\\'b': x")).toEqual({})
		expect(failure("'a\\'b': x")).toMatchObject({ code: 'UNRECOGNIZED_LINE', line: 1 })
	})
})

describe('Core 1.3 §10.2 and Appendix E: a message names what Lima writes instead of a YAML form', () => {
	it.each([
		["k: 'It''s'", 'INVALID_QUOTE', 1, `(YAML doubles the quote; Lima writes 'It\\'s' or "It's")`],
		['k: >\n  a\n  b', 'UNSUPPORTED_YAML', 1, '(Lima writes "|", and "^^" to join lines)'],
		['<<: *base', 'UNRECOGNIZED_LINE', 1, '(a YAML merge key; Lima has no merge keys)'],
		['m:\n  <<: *base', 'UNRECOGNIZED_LINE', 2, '(a YAML merge key; Lima has no merge keys)'],
		['%YAML 1.2', 'UNRECOGNIZED_LINE', 1, '(a YAML directive; Lima has no directives)'],
		['---', 'UNRECOGNIZED_LINE', 1, `(a YAML document marker; Lima has none, and the caller strips the front matter's own "---")`],
		['my key:\n  a: 1', 'UNRECOGNIZED_LINE', 1, "(quote a key that holds spaces: 'my key':)"],
		['seo.title: Hello', 'UNRECOGNIZED_LINE', 1, '(Lima nests by indentation: "seo:", and "title:" below it)'],
		['k: a\n  b', 'INVALID_INDENTATION', 2, '(a value spans lines only after "|")'],
		['m:\n  k: a\n    b', 'INVALID_INDENTATION', 3, '(a value spans lines only after "|")'],
		['k: "a\n  b"', 'INVALID_QUOTE', 1, '(a quoted value ends on its line; write "|" for a value of several lines)'],
		['k: [a,\n  b]', 'INVALID_FLOW_SYNTAX', 1, '(a flow sequence ends on its line; write a block sequence with "- ")'],
	])('%j', (input, code, line, hint) => {
		const error = failure(input)
		expect(error).toMatchObject({ code, line })
		expect(error.message.endsWith(` ${hint}`)).toBe(true)
	})
})
