import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { validateCase } from './schema'
import { materialize } from './corpus-values'
import { runGenerator } from './generators'
import type { DiagnosticExpectation } from './errors'

export interface LoadedCase {
	id: string
	spec: 'core' | 'references'
	specVersion: '1.0' | '1.1' | '2.0'
	section: string
	description: string
	input: string
	/** Entry point: legacy suites default to references; References 2.0 defaults to parse. */
	api: 'core' | 'parse' | 'references'
	options: { strict: boolean; mode: 'core' | 'references'; partials: Record<string, unknown>; partialsSupplied: boolean }
	expectation:
		| { kind: 'result'; value: unknown; warnings: DiagnosticExpectation[] }
		| { kind: 'error'; diagnostic: DiagnosticExpectation }
	tags: string[]
	notes?: string
	sourceFile: string
}

export type LoadResult =
	| { ok: true; case: LoadedCase }
	| { ok: false; sourceFile: string; errors: string[] }

/** Loads and validates a single case from its `.json` sidecar path. */
export function loadCase(jsonPath: string): LoadResult {
	let raw: string
	try {
		raw = readFileSync(jsonPath, 'utf-8')
	} catch (err) {
		return { ok: false, sourceFile: jsonPath, errors: [`cannot read file: ${(err as Error).message}`] }
	}

	let doc: unknown
	try {
		doc = JSON.parse(raw)
	} catch (err) {
		return { ok: false, sourceFile: jsonPath, errors: [`invalid JSON: ${(err as Error).message}`] }
	}

	const validation = validateCase(doc)
	if (!validation.valid) {
		return { ok: false, sourceFile: jsonPath, errors: validation.errors }
	}

	// Safe past this point: `doc` satisfies case.schema.json.
	const d = doc as {
		id: string
		spec: 'core' | 'references'
		specVersion?: '1.0' | '1.1' | '2.0'
		section: string
		description: string
		input?: string
		inputFile?: string
		api?: 'core' | 'parse' | 'references'
		generator?: { name: string; parameters: Record<string, unknown> }
		options?: { strict?: boolean; mode?: 'core' | 'references'; partials?: Record<string, unknown> }
		expect: { result?: unknown; error?: DiagnosticExpectation; warnings?: DiagnosticExpectation[] }
		tags?: string[]
		notes?: string
	}

	let input: string
	let generatorPartials: Record<string, unknown> | undefined
	try {
		if (d.input !== undefined) {
			input = d.input
		} else if (d.inputFile !== undefined) {
			input = readFileSync(join(dirname(jsonPath), d.inputFile), 'utf-8')
		} else {
			// Some generators (partial-count, partial-node-tree,
			// result-node-expansion) also produce the partials map a
			// partial-limit case needs — writing a 4,096-node partial by hand
			// would defeat the point of generating it.
			const generated = runGenerator(d.generator!.name, d.generator!.parameters)
			input = generated.input
			generatorPartials = generated.partials
		}
	} catch (err) {
		return { ok: false, sourceFile: jsonPath, errors: [`cannot resolve input: ${(err as Error).message}`] }
	}

	let expectation: LoadedCase['expectation']
	try {
		if (d.expect.result !== undefined) {
			expectation = {
				kind: 'result',
				value: materialize(d.expect.result as any),
				warnings: d.expect.warnings ?? [],
			}
		} else {
			expectation = { kind: 'error', diagnostic: d.expect.error! }
		}
	} catch (err) {
		return {
			ok: false,
			sourceFile: jsonPath,
			errors: [`cannot materialize expectation: ${(err as Error).message}`],
		}
	}

	const rawPartials = { ...(d.options?.partials ?? {}), ...(generatorPartials ?? {}) }
	const options = {
		strict: d.options?.strict ?? false,
		mode: d.options?.mode ?? 'references',
		partialsSupplied: d.options?.partials !== undefined || generatorPartials !== undefined,
		partials: (materialize(rawPartials as any) as Record<string, unknown>) ?? {},
	}

	return {
		ok: true,
		case: {
			id: d.id,
			spec: d.spec,
			specVersion: d.specVersion ?? '1.0',
			section: d.section,
			description: d.description,
			input,
			// A `spec: "core"` case always defaults to the public `parseCore`
			// entry point — Core cases never involve reference resolution, so
			// there is no reason to route them through a References resolver
			// at all (previously every Core case without an explicit `api`
			// defaulted to `references`, running through the frozen internal
			// References 1.0 resolver instead of the public API it claims to
			// test — see docs/review-2026-09-followups.md P1 #6). Only a
			// `spec: "references"` case's default depends on `specVersion`.
			api: d.api ?? (d.spec === 'core' ? 'core' : d.specVersion === '2.0' ? 'parse' : 'references'),
			options,
			expectation,
			tags: d.tags ?? [],
			notes: d.notes,
			sourceFile: jsonPath,
		},
	}
}

export interface LoadedCorpus {
	cases: LoadedCase[]
	failures: { sourceFile: string; errors: string[] }[]
}

/**
 * Loads every case in the selected versioned suite directories. The default
 * is the current conformance target: Core 1.1 + References 2.0. Core 1.1 is
 * the Core 1.0 corpus without the cases `corpus/manifests/core-1.1.json`
 * lists as superseded, plus `corpus/core-1.1/`; loading `core-1.1` drops the
 * superseded cases from a `core-1.0` loaded with it. The frozen 1.0
 * baselines alone stay loadable on request (`--suite core-1.0`, `--suite
 * references-1.0`). A single malformed case is reported as a failure rather
 * than aborting the whole load.
 */
export const SUITE_DIRECTORIES = {
	'core-1.0': 'core',
	'core-1.1': 'core-1.1',
	'references-1.0': 'references',
	'references-2.0': 'references-2.0',
} as const

export type SuiteName = keyof typeof SUITE_DIRECTORIES

export const DEFAULT_SUITES: readonly SuiteName[] = ['core-1.0', 'core-1.1', 'references-2.0']

/** The ids of the Core 1.0 cases Core 1.1 replaces (`supersedes` in its manifest). */
export const supersededByCore11 = (corpusRoot: string): ReadonlySet<string> =>
	new Set(
		(JSON.parse(readFileSync(join(corpusRoot, 'manifests', 'core-1.1.json'), 'utf8')) as { supersedes: string[] })
			.supersedes,
	)

export function loadCorpus(
	corpusRoot: string,
	suites: readonly SuiteName[] = DEFAULT_SUITES,
): LoadedCorpus {
	const cases: LoadedCase[] = []
	const failures: LoadedCorpus['failures'] = []
	const superseded = suites.includes('core-1.1') ? supersededByCore11(corpusRoot) : new Set<string>()

	for (const suite of suites) {
		const area = SUITE_DIRECTORIES[suite]
		const dir = join(corpusRoot, area)
		let entries: string[]
		try {
			entries = readdirSync(dir)
		} catch {
			continue
		}
		for (const entry of entries.sort()) {
			if (!entry.endsWith('.json')) continue
			const result = loadCase(join(dir, entry))
			if (result.ok) {
				if (suite === 'core-1.0' && superseded.has(result.case.id)) continue
				const expectedVersion = suite.endsWith('-2.0') ? '2.0' : suite === 'core-1.1' ? '1.1' : '1.0'
				if (result.case.specVersion !== expectedVersion) {
					failures.push({
						sourceFile: result.case.sourceFile,
						errors: [`suite ${suite} requires specVersion ${expectedVersion}`],
					})
				} else cases.push(result.case)
			}
			else failures.push(result)
		}
	}

	return { cases, failures }
}
