import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { runCompat, countByClassification } from '../src/run'

const fixturesDir = join(import.meta.dir, '..', '..', 'fixtures', 'frontmatter-samples')

describe('yaml-compat', () => {
	it('loads every fixture without a load-time error', () => {
		const reports = runCompat(fixturesDir)
		expect(reports.length).toBeGreaterThan(0)
	})

	/**
	 * Baseline trip-wire (mirrors corpus/runner/test/run.test.ts's
	 * classification-count pattern): update deliberately, with a written
	 * reason, if this ever changes — never to silently "make the test
	 * pass". A shift here means either a fixture changed, Lima's behavior
	 * changed, or the js-yaml comparison schema changed — all worth
	 * noticing, even though DIVERGE itself is not a failure.
	 *
	 * 14/16 MATCH — both current DIVERGE cases are known, spec-documented,
	 * intentional differences, not bugs:
	 *   - 14-special-characters-quoted.yaml: YAML's `''` doubled-single-
	 *     quote escape vs Lima's `\'` (Core §6.1.3) — Lima's single-quoted
	 *     strings recognise only the backslash form.
	 *   - 16-long-description-block-scalar.yaml: YAML's default block-
	 *     scalar chomping keeps one trailing newline; Lima's `|` strips
	 *     all trailing newlines unconditionally (Core §6.1.5, "Trailing
	 *     content").
	 */
	it('matches the known MATCH/DIVERGE baseline for the current fixture set', () => {
		const reports = runCompat(fixturesDir)
		const counts = countByClassification(reports)
		expect(counts).toEqual({
			MATCH: 14,
			DIVERGE: 2,
			LIMA_ONLY_FAILS: 0,
			YAML_ONLY_FAILS: 0,
			BOTH_FAIL: 0,
		})
	})
})
