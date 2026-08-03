import { describe, it, expect } from 'bun:test'
import { join } from 'node:path'
import { runCorpus } from '../src/run'

const corpusRoot = join(import.meta.dir, '..', '..')

describe('runCorpus', () => {
	it('loads and classifies every case with zero load failures', () => {
		const { outcomes, loadFailures } = runCorpus(corpusRoot)
		expect(loadFailures).toEqual([])
		expect(outcomes).toHaveLength(192)
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
	 * instead of being rejected) → 70/0/0 (10 new Core §6.1.5/§6.1.6 block-
	 * scalar/continuation cases added; found and fixed two more real bugs:
	 * an internal blank line inside a `|` block scalar was silently dropped
	 * instead of being preserved as an empty string in the joined result
	 * (the per-key line split filtered out every blank raw line before the
	 * block-scalar logic ever saw them), and indented freetext with no `|`
	 * marker and no `:` produced an empty mapping `{}` instead of `null` in
	 * non-strict mode, because `parseBlock`'s map-entry branch eagerly
	 * created the result mapping before confirming the line was a valid
	 * entry) → 83/0/0 (13 new Core §6.2-6.4 null/boolean/number cases added;
	 * found and fixed four more real bugs in `toType`'s number handling,
	 * which had delegated to JavaScript's permissive `Number()` instead of
	 * applying the Core §6.4.1 grammar directly: leading zeros ("01") and a
	 * bare trailing decimal point ("1.") were wrongly accepted as numbers;
	 * an integer outside the IEEE 754 safe-integer range lost precision
	 * silently instead of falling back to a string; float overflow to a
	 * non-finite value and non-zero float underflow to zero were not
	 * detected at all — non-strict mode returned Infinity/0 instead of a
	 * string fallback, and strict mode never threw. Added the INVALID_NUMBER
	 * diagnostic code for the two strict-mode number errors, since neither
	 * fit an existing code (docs/corpus-design/error-api.md)) → 94/0/0 (11
	 * new Core §6.5 date cases added; found and fixed a serious deviation:
	 * `parseDateUTC` delegated component validation entirely to
	 * `Date.parse`/the `Date` constructor, which silently roll invalid
	 * calendar dates over into the next valid one instead of rejecting them
	 * (e.g. `2024-02-30` parsed as March 1, `2023-02-29` as March 1) — Core
	 * §6.5.2 explicitly forbids this ("not silently normalised"). Offset
	 * validation (hour 00-14, minute 00 required at hour 14) and the
	 * post-offset UTC-instant range check (years 0001-9999, §6.5.3) were
	 * both entirely missing, and strict mode never threw for any invalid
	 * date at all. Rewrote `parseDateUTC` to extract date/time/offset
	 * components via format-specific regexes (ISO/German/slash) and
	 * validate every component (including calendar-aware day-of-month via
	 * a real leap-year check) before ever constructing a `Date`, instead of
	 * relying on `Date.parse`'s lenient, silently-normalising behavior.
	 * Also fixed two related over-permissive matches inherited from the old
	 * `Date.parse`-based approach: a space-separated ISO datetime (no `T`)
	 * and a single-digit month/day in slash format were both wrongly
	 * accepted; two pre-existing unit tests exercising exactly that
	 * leniency were corrected to the spec-conformant `T`-separated /
	 * two-digit forms) → 130/0/0 (36 new Core §7 collections cases added;
	 * found and fixed three more real bugs. (1) A nested block sequence
	 * (array-in-array, e.g. `- - 1`) was never detected: the outer dash's
	 * value was kept as a literal string instead of becoming `null`, and
	 * the inner sequence's own lines were silently dropped one at a time by
	 * the generic "unexpected indentation" skip rather than being
	 * deliberately consumed as a unit — fixed with an explicit
	 * nested-sequence check in parseBlock's array branch. (2)
	 * `splitFlowItems` only tracked quote state, never `[`/`{` nesting
	 * depth, so a flow sequence containing flow mappings (e.g.
	 * `[{name: Home, url: /}, {name: About, url: /about}]`) split on every
	 * comma inside the nested mappings too, and the "flow nesting depth > 1
	 * throws in both modes" rule was entirely unenforced — fixed by making
	 * the splitter bracket-depth-aware and adding explicit nesting checks in
	 * both parseFlowSequence and parseFlowMapping (a flow mapping may never
	 * contain further nesting at all, which transitively also rejects
	 * SEQ → MAP → SEQ depth-2 constructs). (3) A trailing or leading comma
	 * in a flow sequence or flow mapping was handled inconsistently with
	 * spec: sequences turned a trailing comma into an extra `null` item
	 * instead of ignoring it, and mappings fell back the *entire* mapping to
	 * a string for any leading/trailing/consecutive comma instead of just
	 * skipping the empty element — fixed with comma-position-aware handling
	 * in both functions. Also added the previously entirely-missing
	 * "unclosed `[`/`{` throws in strict mode" check (both functions could
	 * only return `null` for a genuine non-flow value or an unclosed
	 * bracket, by strict-mode elimination, once every other flow error path
	 * already threw directly — added as a single shared check in
	 * resolveValue, the common fallback point for all three call sites) →
	 * 147/0/0 (17 new Core §8-§11/Appendix B cases added, closing out Core
	 * coverage: comments, resource limits — 9 generator-backed cases plus
	 * 3 hand-written ones for points no existing generator produces
	 * (duplicate-count-toward-budget, decoded-quoted-key-length,
	 * code-points-not-UTF-16-units) — the strict-list-is-closed point, and
	 * two API-shape cases. Found and fixed one more real bug: an inline
	 * comment on a value inside a nested block mapping, or on an array-item
	 * continuation-key value, was never stripped — Core §8 requires comment
	 * stripping "at all levels: top-level scalars, values inside block
	 * mappings, and values inside block array items", but only the
	 * top-level and first-line-of-array-item paths ever called
	 * stripComment(); fixed by adding the same call to both of parseBlock's
	 * other itemVal extraction sites (nested map entries and array-item
	 * continuation keys). Two coverage points (C-202 onWarning, C-210
	 * Core-only $key/%key-as-strings) are documented as known legacy-parser
	 * gaps in coverage/core.md rather than forced into a case — the legacy
	 * parser has no onWarning callback and no parseCore distinct from a
	 * References-resolving parse(), so neither is currently exercisable) →
	 * 164/0/0 — Core coverage complete; the References 1.0 matrix begins
	 * here. First sub-batch: §1-§2 (scope, syntax, active-token contexts,
	 * pure-vs-interpolation mode), 17 new cases. Found and fixed three real
	 * deviations from the frozen References spec, all in reference-token
	 * matching/insertion (js/src/index.ts):
	 * (1) PURE_REF_RE/INTERP_RE matched "(" + sigil + "any character but )"
	 * + ")" instead of the precise grammar (References §2.1/§2.2/Appendix
	 * B) — e.g. a dotted partial path like (%foo.bar) wrongly resolved via
	 * a literal "foo.bar" partial lookup, though the partial-key grammar
	 * has no dot at all (partials are flat; dots are document-path-only,
	 * for traversing between key-segments). Rewrote both regexes with
	 * separate per-sigil grammars (document path vs. partial key), each
	 * with its own capture group.
	 * (2) A "bare %key" shorthand (no parentheses) was still implemented
	 * and resolving — but References 1.0 Appendix explicitly lists it as
	 * removed ("(%key) is the only partial syntax"). Deleted the branch
	 * entirely; two pre-existing unit tests exercised exactly this removed
	 * behavior and were corrected to assert the token now stays literal.
	 * (3) A reference resolving to an array, inserted as a sequence item,
	 * was handled inconsistently and always wrong: block-sequence items
	 * spread the array's elements into the surrounding sequence (silently
	 * reintroducing "array spreading of partial values", also explicitly
	 * removed per the Appendix), while flow-sequence items nested it
	 * without complaint, producing an array-in-array Core §7.2 forbids.
	 * Both now throw in both modes (References §3.1/Appendix, R-036/R-143).
	 * Added a new INVALID_REFERENCE_SHAPE diagnostic code for this last
	 * one — distinct from INVALID_INTERPOLATION, which covers the
	 * equivalent string-interpolation-mode rules, not pure-reference mode.
	 * One coverage point (R-120, "parseReferences extends parseCore") is
	 * additionally deferred as a known legacy-parser gap for the same
	 * parseCore-vs-parseReferences reason as Core's C-210.
	 * This snapshot is a regression trip-wire: update it deliberately (with
	 * a written reason) if this ever regresses, never to silently "make the
	 * test pass") → 175/0/0 (11 new References §3.1-3.4 cases added: pure-
	 * reference type preservation/deep-copy/unresolved fallback, numeric-
	 * kind preservation through a multi-hop deep-copy chain, interpolation
	 * unresolved-token handling, dotted-path traversal and its three
	 * unresolved-intermediate conditions (missing/null/non-mapping), and
	 * missing-partial fallback/throw. No new deviations found — this batch
	 * built entirely on resolution machinery already fixed during earlier
	 * §1-§2 and Phase-2 work) → 192/0/0 (17 new References §3.5-3.8 cases
	 * added: canonical string representation for every scalar type, numeric
	 * kind rules, float serialization boundaries, array interpolation, the
	 * one-hop limit's order-independence guarantee, and no-traversal-into-
	 * partials). Found and fixed three more real deviations from the frozen
	 * References spec, all in js/src/index.ts:
	 * (1) A reference to `null` in string interpolation was treated as
	 * "unresolved" (leaving the token unchanged) instead of substituting an
	 * empty string — canonicalString() returned the text "null" via
	 * String(null) if it had been reached at all, and the interpolation
	 * replace callback additionally short-circuited on `resolved === null`
	 * before ever calling it. Fixed both: canonicalString(null) now returns
	 * '', and the null short-circuit was removed (only `undefined` — target
	 * not found — still leaves the token unchanged).
	 * (2) A UTC Instant interpolated into a string used JavaScript's
	 * locale/timezone-dependent String(date) form (e.g. "Fri Mar 01 2024
	 * 08:00:00 GMT+0100 (...)")  instead of the required RFC 3339 form with
	 * seconds and a Z suffix. canonicalString() now special-cases Date
	 * before falling through to the generic String() branch.
	 * (3) The one-hop limit (§3.7) was order-dependent: a chain `a: ($b)` /
	 * `b: ($c)` / `c: 42` only stayed correctly unresolved for `a` when `c`
	 * was written after `b` in the document. Writing `c` before `a`/`b`
	 * caused `b`'s own hop (from `c`) to happen during phase 1 (a
	 * legitimate backward reference, since `c` now precedes `b`), and that
	 * already-resolved value then leaked into the phase-2 snapshot used to
	 * evaluate `a` — letting `a` piggyback a second hop and fully resolve,
	 * in violation of both §4's explicit "the output is independent of
	 * mapping enumeration order" and Appendix 8's "transitive references
	 * ... not supported". Fixed by recording, for every top-level key whose
	 * inline value is itself a pure reference token, that token's original
	 * text; the phase-2 snapshot substitutes it back in for such keys
	 * instead of using their (possibly already hop-resolved) current value,
	 * so a key that was itself a reference can never serve as another key's
	 * target, regardless of where its own target happened to be written.
	 * While chasing (3), also found and fixed a related, independent bug:
	 * `isReferenceFree()` recursively inspected the *string content* of a
	 * partial's value looking for "($" / "(%" substrings — directly
	 * violating §3.8 ("the resolution phases must not rediscover
	 * reference-like substrings by scanning final ... values", stated for
	 * partials specifically). A partial whose value happened to contain
	 * reference-like text (e.g. `{name: "($defaultName)"}`) was therefore
	 * never resolvable via `(%key)` at all. Fixed by marking every string
	 * leaf in a partial's value tree as inactive up front (the same
	 * internal marker quoted document strings already use), so
	 * `isReferenceFree()` and `resolveForward()` treat it as opaque without
	 * inspecting its text — with a new non-mutating unwrap at the
	 * interpolation consumption point, so the shared sanitized partials map
	 * stays protected for any other reference to the same partial.
	 * This snapshot is a regression trip-wire: update it deliberately (with
	 * a written reason) if this ever regresses, never to silently "make the
	 * test pass".
	 */
	it('matches today\'s known Phase-2 baseline classification counts', () => {
		const { outcomes } = runCorpus(corpusRoot)
		const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
		for (const o of outcomes) counts[o.classification]++
		expect(counts).toEqual({ PASS: 192, FAIL: 0, BLOCKED: 0 })
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
