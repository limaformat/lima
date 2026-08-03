import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { validateCase } from './schema'
import { materialize } from './corpus-values'
import { runGenerator } from './generators'
import type { DiagnosticExpectation } from './errors'

export interface LoadedCase {
	id: string
	spec: 'core' | 'references'
	section: string
	description: string
	input: string
	/** Which parser entry point to run against. Defaults to 'references' (parseReferences/parse). */
	api: 'core' | 'references'
	options: { strict: boolean; partials: Record<string, unknown> }
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
		section: string
		description: string
		input?: string
		inputFile?: string
		api?: 'core' | 'references'
		generator?: { name: string; parameters: Record<string, unknown> }
		options?: { strict?: boolean; partials?: Record<string, unknown> }
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
		partials: (materialize(rawPartials as any) as Record<string, unknown>) ?? {},
	}

	return {
		ok: true,
		case: {
			id: d.id,
			spec: d.spec,
			section: d.section,
			description: d.description,
			input,
			api: d.api ?? 'references',
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
 * Loads every case under `corpusRoot`'s `core/`, `references/`, and
 * `generated/` subdirectories. A single malformed case is reported as a
 * failure rather than aborting the whole load.
 */
export function loadCorpus(corpusRoot: string): LoadedCorpus {
	const cases: LoadedCase[] = []
	const failures: LoadedCorpus['failures'] = []

	for (const area of ['core', 'references', 'generated']) {
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
			if (result.ok) cases.push(result.case)
			else failures.push(result)
		}
	}

	return { cases, failures }
}
