import { describe, expect, it } from 'bun:test'
import { parse, parseCore, parseReferences } from './index.js'
import { LimaError } from './errors.js'
import { parseCoreWithPositions } from './core.js'
import { hasActiveReferences2 } from './scalars.js'

describe('References 2.0 public API', () => {
	it('parse resolves document and partial references with the 2.0 syntax', () => {
		expect(parse('name: Ada\nlabel: Hello $(name) from $(:place.city)', {
			partials: { place: { city: 'London' } },
		})).toEqual({ name: 'Ada', label: 'Hello Ada from London' })
	})

	it('parseReferences is an exact compatibility alias', () => {
		expect(parseReferences).toBe(parse)
	})

	it('core mode dispatches to the reference-unaware Core result', () => {
		const input = 'copy: $(source)\nsource: 42'
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

	it('records the source line of an active token inside a block scalar', () => {
		try {
			parse('description: |\n  first line\n  $(missing)\n', { strict: true })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(LimaError)
			expect((error as LimaError).line).toBe(3)
			expect((error as LimaError).token).toBe('$(missing)')
		}
	})

	it('preserves a token physical line across a block-scalar continuation', () => {
		try {
			parse('description: |\n  first line\n  ^^$(missing)\n', { strict: true })
			expect.unreachable()
		} catch (error) {
			expect(error).toBeInstanceOf(LimaError)
			expect((error as LimaError).line).toBe(3)
			expect((error as LimaError).token).toBe('$(missing)')
		}
	})

	it('marks only structural branches containing active 2.0 tokens', () => {
		const tree = parseCoreWithPositions(
			'inert:\n  nested:\n    value: literal\nactive:\n  nested:\n    value: $(source)\nsource: 42\n',
			{ strict: false },
		)
		expect(hasActiveReferences2(tree.get('inert')!)).toBe(false)
		expect(hasActiveReferences2(tree.get('active')!)).toBe(true)
		expect(parse('inert:\n  nested:\n    value: literal\nactive:\n  nested:\n    value: $(source)\nsource: 42\n'))
			.toEqual({ inert: { nested: { value: 'literal' } }, active: { nested: { value: 42 } }, source: 42 })
	})
})
