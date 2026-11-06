import { describe, expect, test } from 'bun:test'
import { outline, parse, parseCore, LimaError } from './index.js'
import { stripKeyQuotes } from './scalars.js'
import { Glob } from 'bun'

// Keep the corpus runner outside this package's TypeScript rootDir.
const { loadCase } = await import(new URL('../../corpus/runner/src/loader.ts', import.meta.url).href)

const paths = (source: string) => outline(source).keys.map((key) => key.path)
const written = (source: string) => {
	const input = source.startsWith('\uFEFF') ? source.slice(1) : source
	return outline(source).keys.map((key) => input.slice(key.span.start.offset, key.span.end.offset))
}

describe('outline', () => {
	test.each(['Autor:in: x', 'a:b: c'])(`uses the parser's colon separator: %s`, (source) => {
		expect(outline(source).keys[0].key).toBe(source.slice(0, source.lastIndexOf(':')))
		expect(written(source)).toEqual([source.slice(0, source.lastIndexOf(':'))])
	})
	test('quoted keys retain quotes in spans and decode their content', () => {
		const source = '"a: b#c\\\"d": x\n\'literal:#\': y\n'
		expect(outline(source).keys.map((k) => k.key)).toEqual(['a: b#c"d', 'literal:#'])
		expect(written(source)).toEqual(['"a: b#c\\\"d"', "'literal:#'"])
		expect(outline(source).comments).toEqual([])
	})
	test.each(['key:', 'key:\n'])('bare key at end of input: %j', (source) => {
		const key = outline(source).keys[0]
		expect(key.path).toEqual(['key'])
		expect(key.separator).toEqual({ start: { line: 1, column: 4, offset: 3 }, end: { line: 1, column: 5, offset: 4 } })
	})
	test('block scalar bodies contain neither keys nor comments', () => {
		const source = 'text: |\n  foo: bar\n  # no comment\nnext: yes # comment\n'
		expect(paths(source)).toEqual([['text'], ['next']])
		const result = outline(source)
		expect(result.comments.map((s) => source.slice(s.start.offset, s.end.offset))).toEqual(['# comment'])
	})
	test('comments use the value reader, including quoted and escaped hashes', () => {
		const source = 'a: value # comment  \nb: "# quoted"\nc: escaped\\#hash#tail\n# whole line\n'
		expect(outline(source).comments.map((s) => source.slice(s.start.offset, s.end.offset)))
			.toEqual(['# comment  ', '#tail', '# whole line'])
	})
	test('nested block mappings and sequence mappings have full paths', () => {
		const source = 'root:\n  child:\n    name: Ada\nitems:\n  - name: A\n    age: 1\n  - nested:\n      name: B\n'
		expect(paths(source)).toEqual([
			['root'], ['root', 'child'], ['root', 'child', 'name'], ['items'],
			['items', '0', 'name'], ['items', '0', 'age'], ['items', '1', 'nested'], ['items', '1', 'nested', 'name'],
		])
	})
	test('flow mappings and mapping items use source order', () => {
		const source = 'a: {x: 1, "y:#": 2}\nb: [{z: 3}, {z: 4}]\n'
		expect(paths(source)).toEqual([['a'], ['a', 'x'], ['a', 'y:#'], ['b'], ['b', '0', 'z'], ['b', '1', 'z']])
	})
	test('CRLF and BOM positions count UTF-16 units in physical input', () => {
		const source = '\uFEFFfirst: 😀\r\nnext: x\r\n'
		const key = outline(source).keys[1]
		expect(key.span.start).toEqual({ line: 2, column: 1, offset: 11 })
		expect(written(source)).toEqual(['first', 'next'])
	})
	test('an emoji before a flow key occupies two UTF-16 units', () => {
		const source = 'a: {"😀": 1, next: 2}'
		const key = outline(source).keys[2]
		expect(key.span.start).toEqual({ line: 1, column: 14, offset: 13 })
	})
	test('half-typed lines do not hide later keys', () => {
		const result = outline('before: x\nhalf typed\nafter: y')
		expect(result.keys.map((k) => k.key)).toEqual(['before', 'after'])
		expect(result.diagnostics).toMatchObject([{ code: 'UNRECOGNIZED_LINE', line: 2 }])
	})
	test.each([
		{ source: 'p:\n  a: 1\n   b: 2\n  : ', paths: [['p'], ['p', 'a']] },
		{ source: 'items:\n  - k1:#\n   k2: v\n', paths: [['items']] },
		{ source: 's:\n  - name:# A\n    -', paths: [['s']] },
		{ source: 'l:\n  - a:# | # c\n    : # c\n', paths: [['l']] },
		{ source: 'p:\n :\r\n[ 1ü\n', paths: [['p']] },
		{ source: 'a:\n  k:\n    :\n      k:\n', paths: [['a'], ['a', 'k']] },
	])('skips entries without source sites: $source', ({ source, paths: expected }) => {
		expect(paths(source)).toEqual([...expected])
		// Dropping an unreadable entry also drops its children, but neither
		// preceding keys nor later siblings lose their source positions.
		expect(paths(source + '\nsibling: ok\n')).toEqual([...expected, ['sibling']])
	})
	test('a missing nested source site does not hide the next nested sibling', () => {
		expect(paths('a:\n  k:\n    :\n      k:\n  sibling: ok\n')).toEqual([
			['a'], ['a', 'k'], ['a', 'sibling'],
		])
	})
	test('duplicates retain each occurrence and report strict errors and later warnings', () => {
		const result = outline('a: 1\na: 2\nb: 3\nb: 4')
		expect(result.keys.map((k) => k.key)).toEqual(['a', 'a', 'b', 'b'])
		expect(result.diagnostics.map((d) => [d.code, d.line])).toEqual([['DUPLICATE_KEY', 2], ['DUPLICATE_KEY', 4]])
	})
	test.each([
		'a: ' + 'x'.repeat(65536),
		'a'.repeat(129) + ': x',
		Array.from({ length: 18 }, (_, i) => '  '.repeat(i) + 'a:').join('\n'),
	])('resource limits return diagnostics and no spans', (source) => {
		const result = outline(source)
		expect(result.diagnostics[0].code).toBe('RESOURCE_LIMIT')
		expect(result.keys).toEqual([])
		expect(result.comments).toEqual([])
	})
	test('sequence keys and their flow children can have the same name', () => {
		const source = 'items:\n  - a: {a: 1}\n    a: {a: 2}\n    nested:\n      nested: 3\n'
		expect(paths(source)).toEqual([
			['items'], ['items', '0', 'a'], ['items', '0', 'a', 'a'],
			['items', '0', 'a'], ['items', '0', 'a', 'a'],
			['items', '0', 'nested'], ['items', '0', 'nested', 'nested'],
		])
		expect(written(source)).toEqual(['items', 'a', 'a', 'a', 'a', 'nested', 'nested'])
	})
	test('nested scalars hide apparent sequence keys and flow mappings', () => {
		const source = 'items:\n  - text: |\n      - a: {a: 1}\n      # literal\n    next: 2 # real\n'
		const result = outline(source)
		expect(result.keys.map((k) => k.path)).toEqual([['items'], ['items', '0', 'text'], ['items', '0', 'next']])
		expect(result.comments.map((s) => source.slice(s.start.offset, s.end.offset))).toEqual(['# real'])
	})
	test('fatal non-strict flow syntax does not hide later nested keys', () => {
		const result = outline('root:\n  before: 1\n  broken: [[], 1]\n  after: 2\nnext: 3')
		expect(result.keys.map((k) => k.path)).toEqual([['root'], ['root', 'before'], ['root', 'broken'], ['root', 'after'], ['next']])
		expect(result.diagnostics).toMatchObject([{ code: 'INVALID_FLOW_SYNTAX', line: 3 }])
	})
	test('duplicate warnings remain available beyond malformed flow values', () => {
		const result = outline('root:\n  a: 1\n  bad: [[], 1]\n  a: 2\nb: 1\nb: 2')
		expect(result.diagnostics.map((d) => [d.code, d.line])).toEqual([
			['INVALID_FLOW_SYNTAX', 3], ['DUPLICATE_KEY', 4], ['DUPLICATE_KEY', 6],
		])
	})
	test('tab expansion and trailing spaces preserve physical spans', () => {
		const source = 'root:\r\n\tkey:   value # hi  \r\nlast:   '
		const result = outline(source)
		expect(result.keys[1].span).toEqual({ start: { line: 2, column: 2, offset: 8 }, end: { line: 2, column: 5, offset: 11 } })
		expect(result.keys.map((k) => source.slice(k.separator.start.offset, k.separator.end.offset))).toEqual([':', ': ', ': '])
		expect(result.comments.map((s) => source.slice(s.start.offset, s.end.offset))).toEqual(['# hi  '])
	})
	test('a limit beyond an earlier strict error still removes every span', () => {
		const result = outline('half typed\na: {a: []}\n' + 'k'.repeat(129) + ': x')
		expect(result.diagnostics[0]).toMatchObject({ code: 'UNRECOGNIZED_LINE', line: 1 })
		expect(result.diagnostics.at(-1)?.code).toBe('RESOURCE_LIMIT')
		expect(result.keys).toEqual([])
		expect(result.comments).toEqual([])
	})
	test('reader positions cross BOM, CRLF, tabs, sequence keys and escaped hashes in flows', () => {
		const source = '\uFEFFr:\r\n\t- a: [{x: v\\#hash, "😀": 2}, {last: 3}] # tail  \r\n\t  end: 4\r\n'
		const physical = source.slice(1)
		const result = outline(source)
		expect(result.keys.map((key) => key.path)).toEqual([
			['r'], ['r', '0', 'a'], ['r', '0', 'a', '0', 'x'],
			['r', '0', 'a', '0', '😀'], ['r', '0', 'a', '1', 'last'], ['r', '0', 'end'],
		])
		const tokens = ['r', 'a', 'x', '"😀"', 'last', 'end']
		for (const [index, token] of tokens.entries()) {
			const start = physical.indexOf(token + ':')
			const lineStart = physical.lastIndexOf('\n', start) + 1
			const line = index === 0 ? 1 : index === tokens.length - 1 ? 3 : 2
			expect(result.keys[index].span).toEqual({
				start: { line, column: start - lineStart + 1, offset: start },
				end: { line, column: start - lineStart + token.length + 1, offset: start + token.length },
			})
			expect(physical.slice(result.keys[index].separator.start.offset, result.keys[index].separator.end.offset))
				.toBe(index === 0 ? ':' : ': ')
		}
		expect(result.comments.map((span) => physical.slice(span.start.offset, span.end.offset))).toEqual(['# tail  '])
	})
	test('the advancing reader reports comments on ignored lines and after scalar dedent', () => {
		const source = '# before\r\nr:\r\n  text: |\r\n    # literal\r\n  next: x # inline  \r\n   ignored # skipped\r\n# after\r\n'
		const result = outline(source)
		expect(result.comments.map((span) => [span.start.line, source.slice(span.start.offset, span.end.offset)]))
			.toEqual([[1, '# before'], [5, '# inline  '], [6, '# skipped'], [7, '# after']])
		expect(result.keys.map((key) => key.path)).toEqual([['r'], ['r', 'text'], ['r', 'next']])
	})
	test('recovery discards unfinished flow key events and retains every later duplicate', () => {
		const count = 2048
		const source = 'r:\n' + '  bad: {x: []}\n'.repeat(count) + '  after: 1\n'
		const result = outline(source)
		expect(result.keys.length).toBe(count + 2)
		expect(result.keys.slice(1, -1).every((key) => key.key === 'bad')).toBe(true)
		expect(result.keys.at(-1)?.path).toEqual(['r', 'after'])
		expect(result.diagnostics.length).toBe(count)
		expect(result.diagnostics[0]).toMatchObject({ code: 'INVALID_FLOW_SYNTAX', line: 2 })
		expect(result.diagnostics.at(-1)).toMatchObject({ code: 'DUPLICATE_KEY', line: count + 1 })
	})
	test('unreadable whole sequence items do not shift later item paths', () => {
		const source = 'r:\n  - [[], 1]\n  - a: 1\n  - {bad: []}\n  - a: 2\n'
		expect(paths(source)).toEqual([['r'], ['r', '0', 'a'], ['r', '1', 'a']])
	})
	test('a wide mapping retains all reader positions in source order', () => {
		const source = 'r:\n' + Array.from({ length: 4000 }, (_, i) => `  k${i}: 1\n`).join('')
		const result = outline(source)
		expect(result.diagnostics).toEqual([])
		expect(result.keys.length).toBe(4001)
		for (let i = 1; i < result.keys.length; i++) {
			expect(result.keys[i].path).toEqual(['r', `k${i - 1}`])
			expect(result.keys[i].span.start.line).toBe(i + 1)
			expect(result.keys[i].span.start.offset).toBeGreaterThan(result.keys[i - 1].span.end.offset)
		}
	})
	test('a wide flow mapping reports physical offsets without reference anchors', () => {
		const source = 'r: {first: escaped\\#hash, ' + Array.from({ length: 4000 }, (_, i) => `k${i}: 1`).join(', ') + '}\n'
		const result = outline(source)
		expect(result.diagnostics).toEqual([])
		expect(result.keys.length).toBe(4002)
		const last = result.keys.at(-1)!
		expect(last.path).toEqual(['r', 'k3999'])
		expect(last.span.start.offset).toBe(source.lastIndexOf('k3999'))
		expect(last.span.end.offset).toBe(last.span.start.offset + 5)
	})
	test('an empty quoted continuation leaves no unmatched key event for its parent', () => {
		const source = 'r:\n  outer:\n    - a: 1\n      "": 2\n      after: 3\n  sibling: 4\n'
		expect(paths(source)).toEqual([
			['r'], ['r', 'outer'], ['r', 'outer', '0', 'a'], ['r', 'outer', '0', ''],
			['r', 'outer', '0', 'after'], ['r', 'sibling'],
		])
	})
	test('malformed editor input never throws', () => {
		let seed = 42
		const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n }
		const lines = ['a: 1', 'a:', 'b: {a: 1, b: 2}', 'b: [[], 2]', 'b: |', '# comment',
			'- a: 1', '- a:', '- {a: 1}', '- b: |', '- a: {a: 2}', 'a: {a: []}', 'half', '', 'b:']
		for (let i = 0; i < 1000; i++) {
			const source = Array.from({ length: 1 + random(12) }, () => ' '.repeat(random(5)) + lines[random(lines.length)]).join('\n')
			expect(() => outline(source)).not.toThrow()
		}
	})
	test('references are values and diagnostics agree with strict parse', () => {
		const source = 'a: ${missing}\nb: $(absent)\n'
		expect(paths(source)).toEqual([['a'], ['b']])
		expect(outline(source).diagnostics[0]).toMatchObject({ code: 'UNRESOLVED_REFERENCE', line: 1 })
	})
})

const corpusRoot = new URL('../../corpus', import.meta.url).pathname
const corpusInputs: { id: string; input: string }[] = []
for (const file of new Glob('*/*.json').scanSync(corpusRoot)) {
	if (file.startsWith('manifests/') || file.startsWith('schema/') || file.startsWith('runner/')) continue
	const loaded = loadCase(`${corpusRoot}/${file}`)
	if (!loaded.ok) throw new Error(`${loaded.sourceFile}: ${loaded.errors.join(', ')}`)
	const { id, input } = loaded.case
	corpusInputs.push({ id, input })
	test(`outline corpus: ${id}`, () => {
		try { parse(input, { strict: true }) } catch (error) {
			if (!(error instanceof LimaError)) throw error
			expect(outline(input).diagnostics[0]).toMatchObject({ code: error.code, line: error.line })
			return
		}
		const result = outline(input)
		expect(result.diagnostics).toEqual([])
		const physical = input.startsWith('\uFEFF') ? input.slice(1) : input
		for (const key of result.keys) {
			expect(stripKeyQuotes(physical.slice(key.span.start.offset, key.span.end.offset))).toBe(key.key)
		}
		const visit = (node: unknown, path: string[]) => {
			if (Array.isArray(node)) { node.forEach((item, i) => visit(item, [...path, String(i)])); return }
			if (node === null || typeof node !== 'object' || node instanceof Date) return
			for (const [key, child] of Object.entries(node)) {
				const childPath = [...path, key]
				expect(result.keys.some((entry) => JSON.stringify(entry.path) === JSON.stringify(childPath))).toBe(true)
				visit(child, childPath)
			}
		}
		// Structural paths exclude keys synthesized by reference substitution.
		visit(parseCore(input), [])
	})
}

test('seeded corpus edits never throw and retain valid physical spans', () => {
	let seed = 0x4c494d41
	const random = (limit: number): number => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
		return Math.floor(seed / 0x100000000 * limit)
	}
	const insertions = [':', ' ', '\n', '#', '"', "'", '{', '}', '[', ']', ',', '-', '|', '\t']
	// Sorting makes the seed independent of filesystem enumeration order.
	for (const { id, input } of [...corpusInputs].sort((a, b) => a.id.localeCompare(b.id))) {
		for (let sample = 0; sample < 4; sample++) {
			let edited = input
			const edits = 1 + random(3)
			for (let edit = 0; edit < edits; edit++) {
				const operation = random(3)
				const position = random(edited.length + 1)
				if (operation === 0) edited = edited.slice(0, position) + insertions[random(insertions.length)] + edited.slice(position)
				else if (operation === 1) edited = edited.slice(0, position) + edited.slice(position + 1 + random(4))
				else edited = edited.slice(0, position)
			}
			const context = `${id}, sample ${sample}, input ${JSON.stringify(edited)}`
			// Calling outline directly also fails the test if it throws.
			const result = outline(edited)
			const physical = edited.startsWith('\uFEFF') ? edited.slice(1) : edited
			for (const key of result.keys) {
				expect(stripKeyQuotes(physical.slice(key.span.start.offset, key.span.end.offset)), context).toBe(key.key)
			}
			for (const span of [...result.keys.flatMap((key) => [key.span, key.separator]), ...result.comments]) {
				expect(Number.isInteger(span.start.offset) && Number.isInteger(span.end.offset), context).toBe(true)
				expect(span.start.offset, context).toBeGreaterThanOrEqual(0)
				expect(span.end.offset, context).toBeGreaterThanOrEqual(span.start.offset)
				expect(span.end.offset, context).toBeLessThanOrEqual(physical.length)
			}
		}
	}
})
