import { describe, it, expect } from 'bun:test'

/**
 * Exercises the actual published entry point (`dist/index.js`, resolved via
 * `package.json`'s `exports`), not `src` — a green `bun test` run against
 * `src` alone does not prove the packaged artifact works.
 */
describe('package export (dist)', () => {
	it('exports parseCore, parseReferences and parse as functions', async () => {
		const mod = await import('../dist/index.js')
		expect(typeof mod.parseCore).toBe('function')
		expect(typeof mod.parseReferences).toBe('function')
		expect(typeof mod.parse).toBe('function')
	})

	it('parses a document through the published entry point', async () => {
		const { parse } = await import('../dist/index.js')
		expect(parse('title: Hello\ndesc: >')).toEqual({ title: 'Hello', desc: '>' })
	})

	it('parseCore is reference-unaware, matching the src implementation (Appendix B)', async () => {
		const { parseCore } = await import('../dist/index.js')
		expect(parseCore('a: ($b)\nb: value')).toEqual({ a: '($b)', b: 'value' })
	})
})
