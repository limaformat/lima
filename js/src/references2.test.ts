import { describe, expect, it } from 'bun:test'
import { parse, parseCore, parseReferences } from './index.js'
import { __parseWithoutResolveCacheForTest } from './references2.js'
import { LimaError } from './errors.js'
import { parseCoreWithPositions } from './core.js'
import { hasActiveReferences2 } from './scalars.js'
import { join } from 'node:path'

// Keep the corpus loader out of js's TypeScript compilation graph: test files
// are excluded from the package build, while `tsc --noEmit` checks them.
const corpusLoaderPath: string = '../../corpus/runner/src/loader.ts'
const { loadCorpus } = await import(corpusLoaderPath)

type CapturedParse =
	| { kind: 'value'; value: unknown; warnings: unknown[] }
	| { kind: 'error'; error: Record<string, unknown>; warnings: unknown[] }

const captureParse = (
	parser: typeof parse,
	input: string,
	options: Parameters<typeof parse>[1],
): CapturedParse => {
	const warnings: unknown[] = []
	try {
		return { kind: 'value', value: parser(input, { ...options, onWarning: (warning) => warnings.push({ ...warning }) }), warnings }
	} catch (error) {
		if (!(error instanceof Error)) return { kind: 'error', error: { thrown: error }, warnings }
		const fields = error instanceof LimaError
			? { code: error.code, line: error.line, column: error.column, token: error.token, key: error.key, partial: error.partial, path: error.path }
			: {}
		return { kind: 'error', error: { name: error.name, message: error.message, ...fields }, warnings }
	}
}

const generatedCacheDocuments = (): string[] => {
	const documents: string[] = []
	const ref = (path: string): string => '${' + path + '}'
	for (let i = 0; i < 1536; i++) {
		const suffix = i.toString(36)
		switch (i % 6) {
			case 0: {
				const edges = i % 5 + 1
				const lines = Array.from({ length: edges }, (_, edge) => `k${edge}: ${ref(`k${edge + 1}`)}`)
				documents.push([...lines, `k${edges}: leaf-${suffix}`, `out: ${ref('k0')}`].join('\n') + '\n')
				break
			}
			case 1:
				documents.push(`base:\n  left: ${suffix}\n  right: [${i}, ${i + 1}]\na: ${ref('base')}\nb: ${ref('base')}\nout: ${ref('a.left')} ${ref('b.left')}\n`)
				break
			case 2:
				documents.push(`a: ${ref('b')}\nb: ${ref('c')}\nc: ${ref('a')}\nout: ${ref('a')}\n`)
				break
			case 3:
				documents.push(`shared:\n  nested:\n    value: ${suffix}\nfirst: ${ref('shared')}\nsecond: ${ref('shared')}\nthird: ${ref('first')}\n`)
				break
			case 4:
				documents.push(`root:\n  a: ${ref('target')}\n  b: ${ref('target')}\ntarget:\n  items: [${i}, ${i + 1}, ${i + 2}]\ncopy: ${ref('root')}\n`)
				break
			default:
				documents.push(`a: ${ref('b')}\nb: ${ref('c')}\nc: ${ref('d')}\nd: ${ref('e')}\ne: ${suffix}\ndiamond: ${ref('a')} ${ref('b')}\n`)
		}
	}
	return documents
}

describe('References 2.0 public API', () => {
	it('matches an uncached resolver oracle across the corpus and generated dependency graphs', () => {
		const corpusRoot = join(import.meta.dir, '..', '..', 'corpus')
		const loaded = loadCorpus(corpusRoot, ['references-2.0'])
		expect(loaded.failures).toEqual([])
		for (const testCase of loaded.cases) {
			const options = {
				strict: testCase.options.strict,
				...(testCase.options.partialsSupplied ? { partials: testCase.options.partials } : {}),
			}
			expect(captureParse(__parseWithoutResolveCacheForTest, testCase.input, options), testCase.id)
				.toEqual(captureParse(parse, testCase.input, options))
		}
		for (const [index, input] of generatedCacheDocuments().entries()) {
			for (const strict of [false, true]) {
				expect(captureParse(__parseWithoutResolveCacheForTest, input, { strict }), `generated ${index}, strict=${strict}`)
					.toEqual(captureParse(parse, input, { strict }))
			}
		}
	})

	it('parse resolves document and partial references with the 2.0 syntax', () => {
		expect(parse('name: Ada\nlabel: Hello ${name} from $(place.city)', {
			partials: { place: { city: 'London' } },
		})).toEqual({ name: 'Ada', label: 'Hello Ada from London' })
	})

	it('resolves a sibling under the same top-level key', () => {
		expect(parse('a:\n  x: 42\n  y: ${a.x}\n')).toEqual({ a: { x: 42, y: 42 } })
	})

	it('resolves another branch under the same top-level key', () => {
		expect(parse('a:\n  b:\n    x: 42\n  c: ${a.b.x}\n'))
			.toEqual({ a: { b: { x: 42 }, c: 42 } })
	})

	it('continues to resolve across different top-level keys', () => {
		expect(parse('a:\n  x: 42\nb: ${a.x}\n')).toEqual({ a: { x: 42 }, b: 42 })
	})

	it('parseReferences is an exact compatibility alias', () => {
		expect(parseReferences).toBe(parse)
	})

	it('core mode dispatches to the reference-unaware Core result', () => {
		const input = 'copy: ${source}\nsource: 42'
		expect(parse(input, { mode: 'core' })).toEqual(parseCore(input))
	})

	it('rejects partials in core mode before parsing', () => {
		expect(() => parse('not valid Lima', { mode: 'core', partials: {} })).toThrow(TypeError)
	})

	it('rejects an unsupported runtime mode', () => {
		expect(() => parse('value: 1', { mode: 'legacy' } as never)).toThrow(TypeError)
	})

	it('keeps References 1.0 tokens literal', () => {
		expect(parse('old: ($source)\nsource: 42')).toEqual({ old: '($source)', source: 42 })
	})

	it('treats the briefly published partial syntax as literal', () => {
		expect(parse('old: $(:source)\nsource: 42', { strict: true }))
			.toEqual({ old: '$(:source)', source: 42 })
	})

	it('interprets $(key) as a partial rather than a document reference', () => {
		expect(parse('source: document\ncopy: $(source)', { partials: { source: 'partial' } }))
			.toEqual({ source: 'document', copy: 'partial' })
	})

	it('records the source line of an active token inside a block scalar', () => {
		try {
			parse('description: |\n  first line\n  ${missing}\n', { strict: true })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(LimaError)
			expect((error as LimaError).line).toBe(3)
			expect((error as LimaError).token).toBe('${missing}')
		}
	})

	it('preserves a token physical line across a block-scalar continuation', () => {
		try {
			parse('description: |\n  first line\n  ^^${missing}\n', { strict: true })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(LimaError)
			expect((error as LimaError).line).toBe(3)
			expect((error as LimaError).token).toBe('${missing}')
		}
	})

	it('retains an earlier root insertion when a pure-reference result is copied again', () => {
		const input = `middle: \${base}
base:
  n0:
    n1:
      n2:
        n3:
          v: x
outer:
  n0:
    n1:
      n2:
        n3:
          n4:
            n5:
              n6:
                n7:
                  n8:
                    n9:
                      n10:
                        v: \${middle}`
		try {
			parse(input)
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(LimaError)
			expect((error as LimaError).code).toBe('RESOURCE_LIMIT')
			expect((error as LimaError).line).toBe(1)
			expect((error as LimaError).column).toBe(9)
			expect((error as LimaError).token).toBe('${base}')
		}
	})

	it('attributes a deep partial copy only to its document insertion token', () => {
		let deep: unknown = 'leaf'
		for (let i = 15; i >= 0; i--) deep = { [`n${i}`]: deep }
		try {
			parse('outer:\n  v: $(deep)', { partials: { deep } })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(LimaError)
			expect((error as LimaError).code).toBe('RESOURCE_LIMIT')
			expect((error as LimaError).line).toBe(2)
			expect((error as LimaError).column).toBe(6)
			expect((error as LimaError).token).toBe('$(deep)')
		}
	})

	it('marks only structural branches containing active 2.0 tokens', () => {
		const tree = parseCoreWithPositions(
			'inert:\n  nested:\n    value: literal\nactive:\n  nested:\n    value: ${source}\nsource: 42\n',
			{ strict: false },
		)
		expect(hasActiveReferences2(tree.get('inert')!)).toBe(false)
		expect(hasActiveReferences2(tree.get('active')!)).toBe(true)
		expect(parse('inert:\n  nested:\n    value: literal\nactive:\n  nested:\n    value: ${source}\nsource: 42\n'))
			.toEqual({ inert: { nested: { value: 'literal' } }, active: { nested: { value: 42 } }, source: 42 })
	})
})
