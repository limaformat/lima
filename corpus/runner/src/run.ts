import { join } from 'node:path'
import {
	DEFAULT_SUITES, loadCorpus, SUITE_DIRECTORIES,
	type LoadedCase, type LoadedCorpus, type SuiteName,
} from './loader'
import { corpusValuesEqual, diffCorpusValues, hasOnlySafeOwnDataProperties } from './normalize'
import { compareDiagnostic, type LimaDiagnostic } from './errors'
import { parse, parseCore, parseReferences } from '../../../js/src/index'
import { parseReferencesV1 } from '../../../js/src/references'
import { LimaError } from '../../../js/src/errors'

export type AdaptedDiagnostic =
	| { mapped: true; diagnostic: LimaDiagnostic }
	| { mapped: false; rawMessage: string }

/**
 * Reads the structured diagnostic directly off a `LimaError` — or an
 * `onWarning` payload carrying the same shape; the public `Diagnostic` type
 * js/src exposes is spec-frozen to `{message, line}` (Core §11.2), but the
 * concrete object js/src actually delivers is the richer `LimaDiagnostic`.
 * Every throw site in js/src now carries one (verified: a full corpus run
 * produces zero errors and zero warnings without a `code`), so there is no
 * message-regex fallback — anything without a `code` is reported unmapped
 * rather than guessed at, so it can never be silently miscounted as PASS.
 */
function classify(error: unknown): AdaptedDiagnostic {
	const d = error instanceof LimaError ? error
		: (typeof error === 'object' && error !== null && 'code' in error && 'message' in error ? error : null)
	if (d === null) {
		const message = error instanceof Error ? error.message : String(error)
		return { mapped: false, rawMessage: message }
	}
	const { code, message, line, column, token, key, partial, path } = d as LimaDiagnostic
	return {
		mapped: true,
		diagnostic: {
			code, message,
			...(line !== undefined ? { line } : {}),
			...(column !== undefined ? { column } : {}),
			...(token !== undefined ? { token } : {}),
			...(key !== undefined ? { key } : {}),
			...(partial !== undefined ? { partial } : {}),
			...(path !== undefined ? { path } : {}),
		},
	}
}

export type Classification = 'PASS' | 'FAIL' | 'BLOCKED'

export interface CaseOutcome {
	id: string
	sourceFile: string
	classification: Classification
	/** Why the case failed or was blocked. Empty when classification is PASS. */
	reasons: string[]
	/** Non-blocking observations (e.g. a warning the adapter could not classify). */
	notes: string[]
}

/**
 * Runs the case's chosen entry point (`c.api`) via the real `onWarning`
 * callback (Core §11.2) — each raw `{message, line}` diagnostic is run
 * through the same message-classifying adapter used for thrown errors, so
 * `expect.warnings` can finally be compared for real instead of only noted.
 * `api: "core"` calls `parseCore` directly, with no partials option (Core
 * has none — the schema/loader reject a case that tries to combine the
 * two), which is how C-210/R-120 (parseCore never resolves references) are
 * exercised without going through References resolution at all.
 */
function invokeParser(c: LoadedCase): {
	result: { threw: false; value: unknown } | { threw: true; error: unknown }
	warnings: LimaDiagnostic[]
	unmappedWarnings: string[]
} {
	const warnings: LimaDiagnostic[] = []
	const unmappedWarnings: string[] = []
	const onWarning = (d: { message: string; line: number }) => {
		const adapted = classify(d)
		if (adapted.mapped) warnings.push(adapted.diagnostic)
		else unmappedWarnings.push(d.message)
	}
	try {
		const referenceOptions = {
			...(c.options.partialsSupplied ? { partials: c.options.partials } : {}),
			strict: c.options.strict,
			onWarning,
			mode: c.options.mode,
		}
		const value = c.api === 'core'
			? parseCore(c.input, { strict: c.options.strict, onWarning })
			: c.specVersion === '1.0'
				? parseReferencesV1(c.input, referenceOptions)
			: c.api === 'references'
				? parseReferences(c.input, referenceOptions)
				: parse(c.input, referenceOptions)
		return { result: { threw: false, value }, warnings, unmappedWarnings }
	} catch (error) {
		return { result: { threw: true, error }, warnings, unmappedWarnings }
	}
}

/**
 * Core is reference-unaware by construction (Appendix B): for a
 * referenceless document, `parseCore` and `parse` (References 2.0) must
 * produce an identical value. Cross-checking every passing `spec: "core"`
 * case against `parse` too, not only `parseCore`, is what actually
 * exercises the public References entry point on Core input — the two
 * builders (`nativeBuilder` in core.ts, `positionedBuilder` used by
 * references2.ts) are independent code paths that a Core-only run could
 * never catch drifting apart. See docs/review-2026-09-followups.md P1 #6.
 */
function crossCheckAgainstParse(c: LoadedCase, coreValue: unknown): string[] {
	try {
		const value = parse(c.input, {
			...(c.options.partialsSupplied ? { partials: c.options.partials } : {}),
			strict: c.options.strict,
		})
		return diffCorpusValues(value, coreValue).map(
			(m) => `parse() diverges from parseCore() on this referenceless input — ${m}`,
		)
	} catch (error) {
		const adapted = classify(error)
		const detail = adapted.mapped ? `${adapted.diagnostic.code}: ${adapted.diagnostic.message}` : adapted.rawMessage
		return [`parseCore() succeeded but parse() threw on the same referenceless input: ${detail}`]
	}
}

function runCase(c: LoadedCase): CaseOutcome {
	const { result, warnings, unmappedWarnings } = invokeParser(c)
	const notes =
		unmappedWarnings.length > 0
			? [`parser emitted a warning the adapter could not classify: ${unmappedWarnings.join(' | ')}`]
			: []

	if (c.expectation.kind === 'result') {
		if (result.threw) {
			const adapted = classify(result.error)
			const reason = adapted.mapped
				? `expected a successful result, but parsing threw ${adapted.diagnostic.code}: ${adapted.diagnostic.message}`
				: `expected a successful result, but parsing threw an unmapped error: ${adapted.rawMessage}`
			return { id: c.id, sourceFile: c.sourceFile, classification: 'FAIL', reasons: [reason], notes }
		}

		const reasons = diffCorpusValues(result.value, c.expectation.value)
		if (!hasOnlySafeOwnDataProperties(result.value)) {
			reasons.push('result is not a prototype-free object with only own data properties (binding check)')
		}

		const expectedWarnings = c.expectation.warnings
		if (warnings.length !== expectedWarnings.length) {
			reasons.push(`expected ${expectedWarnings.length} warning(s), got ${warnings.length}`)
		} else {
			expectedWarnings.forEach((expected, i) => {
				for (const m of compareDiagnostic(warnings[i], expected)) {
					reasons.push(`warnings[${i}].${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
				}
			})
		}

		if (reasons.length === 0 && c.spec === 'core' && c.api === 'core') {
			reasons.push(...crossCheckAgainstParse(c, result.value))
		}

		return {
			id: c.id,
			sourceFile: c.sourceFile,
			classification: reasons.length === 0 ? 'PASS' : 'FAIL',
			reasons,
			notes,
		}
	}

	// c.expectation.kind === 'error'
	if (!result.threw) {
		return {
			id: c.id,
			sourceFile: c.sourceFile,
			classification: 'FAIL',
			reasons: ['expected an error, but parsing succeeded'],
			notes,
		}
	}

	const adapted = classify(result.error)
	if (!adapted.mapped) {
		return {
			id: c.id,
			sourceFile: c.sourceFile,
			classification: 'BLOCKED',
			reasons: [`legacy adapter could not classify the thrown error: ${adapted.rawMessage}`],
			notes,
		}
	}

	const mismatches = compareDiagnostic(adapted.diagnostic, c.expectation.diagnostic)
	if (mismatches.length > 0) {
		return {
			id: c.id,
			sourceFile: c.sourceFile,
			classification: 'FAIL',
			reasons: mismatches.map(
				(m) => `${m.field}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`
			),
			notes,
		}
	}

	return { id: c.id, sourceFile: c.sourceFile, classification: 'PASS', reasons: [], notes }
}

export interface CorpusRunResult {
	outcomes: CaseOutcome[]
	loadFailures: LoadedCorpus['failures']
}

export function runCorpus(
	corpusRoot: string,
	suites: readonly SuiteName[] = DEFAULT_SUITES,
): CorpusRunResult {
	const { cases, failures } = loadCorpus(corpusRoot, suites)
	return { outcomes: cases.map(runCase), loadFailures: failures }
}

// CLI entry point: `bun src/run.ts` (or `bun run run` via package.json).
if (import.meta.main) {
	const corpusRoot = join(import.meta.dir, '..', '..')
	const args = process.argv.slice(2)
	const suites: SuiteName[] = []
	for (let i = 0; i < args.length; i++) {
		if (args[i] !== '--suite' || i + 1 >= args.length) {
			console.error('usage: bun src/run.ts [--suite core-1.0|references-1.0|references-2.0]...')
			process.exit(2)
		}
		const suite = args[++i] as SuiteName
		if (!(suite in SUITE_DIRECTORIES)) {
			console.error(`unknown suite: ${suite}`)
			process.exit(2)
		}
		suites.push(suite)
	}
	const selectedSuites = suites.length > 0 ? suites : DEFAULT_SUITES
	const { outcomes, loadFailures } = runCorpus(corpusRoot, selectedSuites)

	for (const outcome of outcomes) {
		console.log(`[${outcome.classification}] ${outcome.id}`)
		for (const reason of outcome.reasons) console.log(`    ${reason}`)
		for (const note of outcome.notes) console.log(`    (${note})`)
	}
	for (const failure of loadFailures) {
		console.log(`[LOAD-FAILED] ${failure.sourceFile}`)
		for (const error of failure.errors) console.log(`    ${error}`)
	}

	const counts = { PASS: 0, FAIL: 0, BLOCKED: 0 }
	for (const o of outcomes) counts[o.classification]++
	console.log(
		`\n${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.BLOCKED} BLOCKED, ` +
			`${loadFailures.length} load failures (${outcomes.length} cases total)`
	)
}
