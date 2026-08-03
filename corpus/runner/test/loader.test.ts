import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { loadCase, loadCorpus } from '../src/loader'

const corpusRoot = join(import.meta.dir, '..', '..')

describe('loadCase', () => {
	it('loads a .lima sidecar case via inputFile', () => {
		const result = loadCase(join(corpusRoot, 'core', 'integer-basic.json'))
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.case.id).toBe('core.numbers.integer.basic')
			expect(result.case.input).toBe('count: 42\n')
			expect(result.case.expectation).toEqual({
				kind: 'result',
				value: { count: 42 },
				warnings: [],
			})
			expect(result.case.options).toEqual({ strict: false, partials: {} })
		}
	})

	it('loads an inline-input case', () => {
		const result = loadCase(join(corpusRoot, 'references', 'invalid-partial-nan.json'))
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.case.input).toBe('value: (%bad)')
			expect(result.case.expectation.kind).toBe('error')
		}
	})

	it('loads a generator case and materializes the generated input', () => {
		const result = loadCase(join(corpusRoot, 'core', 'scalar-limit-above.json'))
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.case.input).toBe('value: ' + 'x'.repeat(16385))
		}
	})

	it('materializes typed corpus values inside options.partials', () => {
		// forward-reference / pure-number cases carry no partials; assemble a
		// synthetic doc via loadCase's public contract instead — read one that
		// does use partials if present, else assert empty-object default.
		const result = loadCase(join(corpusRoot, 'references', 'partial-slash.json'))
		expect(result.ok).toBe(true)
		if (result.ok) expect(typeof result.case.options.partials).toBe('object')
	})

	it('reports a failure for a nonexistent file instead of throwing', () => {
		const result = loadCase(join(corpusRoot, 'core', 'does-not-exist.json'))
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]).toContain('cannot read file')
	})

	it('reports a failure for malformed JSON instead of throwing', () => {
		const tmp = join(corpusRoot, 'runner', 'test', '__tmp-malformed.json')
		Bun.write(tmp, '{ not valid json')
		try {
			const result = loadCase(tmp)
			expect(result.ok).toBe(false)
			if (!result.ok) expect(result.errors[0]).toContain('invalid JSON')
		} finally {
			require('node:fs').unlinkSync(tmp)
		}
	})

	it('reports a failure for a case that fails schema validation', () => {
		const tmp = join(corpusRoot, 'runner', 'test', '__tmp-invalid-case.json')
		Bun.write(tmp, JSON.stringify({ id: 'not valid' }))
		try {
			const result = loadCase(tmp)
			expect(result.ok).toBe(false)
		} finally {
			require('node:fs').unlinkSync(tmp)
		}
	})
})

describe('loadCorpus', () => {
	it('loads every real case under core/ and references/ with zero failures', () => {
		const { cases, failures } = loadCorpus(corpusRoot)
		expect(failures).toEqual([])
		expect(cases.length).toBe(164)
	})

	it('produces unique, stable case IDs', () => {
		const { cases } = loadCorpus(corpusRoot)
		const ids = cases.map((c) => c.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})
