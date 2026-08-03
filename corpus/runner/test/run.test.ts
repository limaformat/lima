import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { runCorpus } from '../src/run'

const corpusRoot = join(import.meta.dir, '..', '..')

describe('runCorpus', () => {
	it('loads and classifies every case with zero load failures', () => {
		const { outcomes, loadFailures } = runCorpus(corpusRoot)
		expect(loadFailures).toEqual([])
		expect(outcomes).toHaveLength(18)
	})

	it('gives every case a definite classification and, for FAIL/BLOCKED, at least one reason', () => {
		const { outcomes } = runCorpus(corpusRoot)
		for (const outcome of outcomes) {
			expect(['PASS', 'FAIL', 'BLOCKED']).toContain(outcome.classification)
			if (outcome.classification !== 'PASS') {
				expect(outcome.reasons.length).toBeGreaterThan(0)
			}
		}
	})

	/**
	 * Phase-1 baseline (docs/corpus-design/README.md §11): the legacy parser
	 * (js/src/index.ts) predates the frozen 1.0 specs, so a majority of
	 * cases are expected to FAIL for now — that is the whole point of this
	 * measuring instrument. This snapshot is a regression trip-wire: update
	 * it deliberately (with a written reason) once Phase 2 fixes land, never
	 * to silently "make the test pass".
	 */
	it('matches today\'s known Phase-1 baseline classification counts', () => {
		const { outcomes } = runCorpus(corpusRoot)
		const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
		for (const o of outcomes) counts[o.classification]++
		expect(counts).toEqual({ PASS: 0, FAIL: 18, BLOCKED: 0 })
	})

	it('flags every FAIL caused only by the missing prototype-free binding as otherwise-passing', () => {
		// Cross-check: cases whose only reason is the binding check would be
		// PASS once js/src/index.ts returns Object.create(null) results —
		// documented here so Phase 2 has a concrete, mechanically-verifiable
		// starting point instead of re-deriving it from console output.
		const { outcomes } = runCorpus(corpusRoot)
		const onlyBindingIssue = outcomes.filter(
			(o) =>
				o.classification === 'FAIL' &&
				o.reasons.length === 1 &&
				o.reasons[0].includes('prototype-free')
		)
		expect(onlyBindingIssue.map((o) => o.id).sort()).toEqual(
			[
				'core.dates.iso-offset.utc-conversion',
				'core.keys.duplicate.non-strict',
				'core.numbers.integer.basic',
				'core.strings.unknown-escape.non-strict',
				'references.interpolation.block-scalar.basic',
				'references.partials.slash-key.literal',
				'references.phases.forward-reference.phase-2',
				'references.pure.document-number.backward',
			].sort()
		)
	})
})
