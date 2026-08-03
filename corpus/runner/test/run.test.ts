import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { runCorpus } from '../src/run'

const corpusRoot = join(import.meta.dir, '..', '..')

describe('runCorpus', () => {
	it('loads and classifies every case with zero load failures', () => {
		const { outcomes, loadFailures } = runCorpus(corpusRoot)
		expect(loadFailures).toEqual([])
		expect(outcomes).toHaveLength(60)
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
	 * Phase-2 baseline (docs/corpus-design/README.md §11), progressively
	 * updated as confirmed deviations are fixed in js/src/index.ts and as
	 * corpus coverage expands. History: 0/18/0 (initial run) → 8/9/1
	 * (prototype-free + deep-copy fix) → 11/6/1 (^^ leading marker, strict
	 * trailing-comma, strict unknown-escape) → 17/0/1 (float exponent,
	 * partial NaN validation, one-hop snapshot fix, quoted-token inactivity,
	 * unresolved-reference line number, scalar resource limit) → 18/0/0
	 * (mapping-interpolation rejected with INVALID_INTERPOLATION) → 23/0/0
	 * (5 new Core §3 normalization cases added; found and fixed a real bug
	 * where the single `\r\n|\t` normalization pass converted every tab in
	 * the document, not just leading-indentation tabs, and never handled a
	 * standalone \r) → 32/0/0 (9 new Core §4 document-structure cases added;
	 * found and fixed two more real bugs: an inline (`: `) value with no
	 * `|`/`>` marker was implicitly merging any indented follow-on lines
	 * into a multi-line string — not frozen-spec behavior, Core §6.1.5
	 * requires an explicit `|` marker — and strict mode never threw on
	 * non-whitespace content after a closing quote) → 42/0/0 (10 new Core §5
	 * key/duplicate cases added; found and fixed three more real bugs: a
	 * double-quoted key containing an escaped quote wasn't recognized as a
	 * key at all — KEY_RE's `"([^"]*)"` stopped at the escaped quote too —
	 * strict mode never threw on a space between a quoted key's closing
	 * quote and the colon, and duplicate-key detection only ever existed at
	 * the top level, never for nested block mappings or flow mappings) →
	 * 60/0/0 (18 new Core §6.1 Strings cases added; found and fixed three
	 * more real bugs in double-quoted escape handling: `\0` was decoded as
	 * a null character instead of being treated as an unknown escape per
	 * Core Appendix A, an out-of-range `\U00110000` codepoint crashed with
	 * a raw uncaught RangeError instead of falling back/throwing through
	 * the normal escape-error path, and a UTF-16 surrogate in `\uXXXX`
	 * (U+D800-U+DFFF) decoded to an invalid unpaired surrogate character
	 * instead of being rejected).
	 * This snapshot is a regression trip-wire: update it deliberately (with
	 * a written reason) if this ever regresses, never to silently "make the
	 * test pass".
	 */
	it('matches today\'s known Phase-2 baseline classification counts', () => {
		const { outcomes } = runCorpus(corpusRoot)
		const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
		for (const o of outcomes) counts[o.classification]++
		expect(counts).toEqual({ PASS: 60, FAIL: 0, BLOCKED: 0 })
	})

	it('no longer has any case failing solely on the prototype-free binding check', () => {
		// Regression guard: the eight cases that used to fail only on this
		// check are now expected to PASS outright.
		const { outcomes } = runCorpus(corpusRoot)
		const onlyBindingIssue = outcomes.filter(
			(o) =>
				o.classification === 'FAIL' &&
				o.reasons.length === 1 &&
				o.reasons[0].includes('prototype-free')
		)
		expect(onlyBindingIssue).toEqual([])
	})

	it('normalizes a standalone CR and preserves tabs inside scalar content', () => {
		// Both were broken by the same bug: a single combined `\r\n|\t`
		// normalization pass never matched a lone \r, and converted every
		// tab in the document (not just leading-indentation ones).
		const { outcomes } = runCorpus(corpusRoot)
		for (const id of [
			'core.normalization.line-endings.standalone-cr',
			'core.normalization.tabs.preserved-in-scalar',
		]) {
			expect(outcomes.find((o) => o.id === id)?.classification).toBe('PASS')
		}
	})

	it('rejects mapping interpolation with INVALID_INTERPOLATION instead of crashing', () => {
		// references.interpolation.mapping.error used to crash with a raw
		// TypeError ("No default value" from String() on a prototype-free
		// mapping) instead of being rejected per References §3.5. Regression
		// guard for the fix.
		const { outcomes } = runCorpus(corpusRoot)
		const outcome = outcomes.find((o) => o.id === 'references.interpolation.mapping.error')
		expect(outcome?.classification).toBe('PASS')
	})
})
