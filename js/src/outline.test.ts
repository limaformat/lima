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
for (const file of new Glob('*/*.json').scanSync(corpusRoot)) {
	if (file.startsWith('manifests/') || file.startsWith('schema/') || file.startsWith('runner/')) continue
	const loaded = loadCase(`${corpusRoot}/${file}`)
	if (!loaded.ok) throw new Error(`${loaded.sourceFile}: ${loaded.errors.join(', ')}`)
	const { id, input } = loaded.case
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
