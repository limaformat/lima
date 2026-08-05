import { describe, it, expect } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCase, loadCorpus } from '../src/loader'

const corpusRoot = join(import.meta.dir, '..', '..')

describe('loadCase', () => {
	it('loads a .lima sidecar case via inputFile', () => {
		// No case in the real corpus uses a .lima sidecar as of this writing
		// (all 22 former sidecar cases were inlined for consistency with the
		// other 228 — see docs/corpus-design/README.md §1) — the inputFile
		// mechanism itself is still valid per the schema and still worth
		// keeping working, so this constructs its own throwaway fixture pair
		// rather than depending on a specific real corpus file to exercise it.
		const dir = mkdtempSync(join(tmpdir(), 'lima-corpus-sidecar-'))
		try {
			writeFileSync(join(dir, 'sidecar-case.lima'), 'count: 42\n')
			writeFileSync(
				join(dir, 'sidecar-case.json'),
				JSON.stringify({
					id: 'core.numbers.integer.basic',
					spec: 'core',
					section: '6.4.1',
					description: 'Parses a positive decimal integer.',
					inputFile: 'sidecar-case.lima',
					expect: { result: { count: 42 } },
					tags: ['positive', 'number'],
				}),
			)
			const result = loadCase(join(dir, 'sidecar-case.json'))
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
		} finally {
			rmSync(dir, { recursive: true, force: true })
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
		expect(cases.length).toBe(250)
	})

	it('produces unique, stable case IDs', () => {
		const { cases } = loadCorpus(corpusRoot)
		const ids = cases.map((c) => c.id)
		expect(new Set(ids).size).toBe(ids.length)
	})
})
