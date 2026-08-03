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
	 * Phase-2 baseline (docs/corpus-design/README.md §11), updated 2026-08-03
	 * after js/src/index.ts was fixed to return prototype-free results
	 * (Core §11.1) and to deep-copy pure-reference values instead of
	 * aliasing them (References §3.1/§6.2) — see "Nachtrag" in this repo's
	 * history for the reasoning. Originally 0 PASS / 18 FAIL / 0 BLOCKED.
	 * This snapshot is a regression trip-wire: update it deliberately (with
	 * a written reason) as further Phase-2 fixes land, never to silently
	 * "make the test pass".
	 */
	it('matches today\'s known Phase-2 baseline classification counts', () => {
		const { outcomes } = runCorpus(corpusRoot)
		const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
		for (const o of outcomes) counts[o.classification]++
		expect(counts).toEqual({ PASS: 8, FAIL: 9, BLOCKED: 1 })
	})

	it('no longer has any case failing solely on the prototype-free binding check', () => {
		// Regression guard for the fix above: the eight cases that used to
		// fail only on this check are now expected to PASS outright.
		const { outcomes } = runCorpus(corpusRoot)
		const onlyBindingIssue = outcomes.filter(
			(o) =>
				o.classification === 'FAIL' &&
				o.reasons.length === 1 &&
				o.reasons[0].includes('prototype-free')
		)
		expect(onlyBindingIssue).toEqual([])
	})

	it('classifies the one known remaining crash as BLOCKED, not a false PASS', () => {
		// references.interpolation.mapping.error: the legacy parser calls
		// String() on a mapping during interpolation instead of rejecting it
		// (References §3.5 requires INVALID_INTERPOLATION). Since results are
		// now prototype-free, String() on the nested mapping throws a raw
		// TypeError ("No default value") instead of silently producing
		// "[object Object]" — same underlying bug, now impossible to miss.
		// The legacy adapter correctly refuses to guess a code for it.
		const { outcomes } = runCorpus(corpusRoot)
		const outcome = outcomes.find((o) => o.id === 'references.interpolation.mapping.error')
		expect(outcome?.classification).toBe('BLOCKED')
	})
})
