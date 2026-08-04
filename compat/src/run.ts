/**
 * YAML/Lima divergence report on realistic frontmatter — NOT a conformance
 * check. Lima's own spec (docs/lima-core-1.0-spec.md) is the only
 * authority for what Lima must do; js-yaml here is a comparison baseline,
 * not a source of truth. Divergence from YAML is expected and by design
 * (Lima is deliberately not YAML-compatible — no anchors/aliases, no `>`
 * folded block scalar, its own scalar-coercion and date rules); this tool
 * exists to make WHERE and HOW OFTEN that happens visible on realistic
 * input, not to fail a build over it. See fixtures/frontmatter-samples/
 * README.md for the sample corpus this runs against and
 * docs/corpus-design/README.md for the (unrelated, spec-conformance)
 * corpus this deliberately does not extend.
 *
 * Core only, non-strict: References/partials have no YAML equivalent, and
 * real-world frontmatter is tolerant/imperfect — non-strict is the
 * realistic comparison point, not strict.
 *
 * Run: `bun run run` (from `compat/`) or `bun src/run.ts`. Add `--json`
 * for machine-readable output.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCore } from '../../js/src/index'
import { load, YAML11_SCHEMA } from 'js-yaml'
import { corpusValuesEqual, diffCorpusValues } from '../../corpus/runner/src/normalize'

const JSON_OUTPUT = Bun.argv.includes('--json')

export type Classification = 'MATCH' | 'DIVERGE' | 'LIMA_ONLY_FAILS' | 'YAML_ONLY_FAILS' | 'BOTH_FAIL'

export interface SampleReport {
	file: string
	classification: Classification
	/** Path-level diffs (yaml as the baseline/"expected" side) — only set for DIVERGE. */
	diffs?: string[]
	limaError?: string
	yamlError?: string
}

/**
 * Classifies a single sample. `yaml.load` is treated as the comparison
 * baseline (the "expected" side of `diffCorpusValues`) purely for diff
 * wording ("expected <yaml>, got <lima>") — it carries no authority over
 * what Lima should produce.
 */
export function classifySample(file: string, content: string): SampleReport {
	let limaResult: unknown
	let limaError: string | undefined
	try {
		limaResult = parseCore(content)
	} catch (e) {
		limaError = e instanceof Error ? e.message : String(e)
	}

	let yamlResult: unknown
	let yamlError: string | undefined
	try {
		// js-yaml's `load()` default (CORE_SCHEMA, YAML 1.2) does NOT
		// implicitly resolve timestamps — a recent, more conservative
		// js-yaml default, not representative of what real frontmatter
		// tooling actually produces (Jekyll/Psych, older js-yaml versions,
		// gray-matter's historical default all resolve dates). YAML11_SCHEMA
		// restores that resolution, matching real-world practice — using
		// the bare default here would inflate DIVERGE count on a dimension
		// where Lima is doing the expected thing, not an unexpected one.
		yamlResult = load(content, { schema: YAML11_SCHEMA })
	} catch (e) {
		yamlError = e instanceof Error ? e.message : String(e)
	}

	if (limaError !== undefined && yamlError !== undefined) return { file, classification: 'BOTH_FAIL', limaError, yamlError }
	if (limaError !== undefined) return { file, classification: 'LIMA_ONLY_FAILS', limaError }
	if (yamlError !== undefined) return { file, classification: 'YAML_ONLY_FAILS', yamlError }
	if (corpusValuesEqual(limaResult, yamlResult)) return { file, classification: 'MATCH' }
	return { file, classification: 'DIVERGE', diffs: diffCorpusValues(limaResult, yamlResult) }
}

export function runCompat(fixturesDir: string): SampleReport[] {
	const files = readdirSync(fixturesDir).filter((f) => f.endsWith('.yaml')).sort()
	return files.map((file) => classifySample(file, readFileSync(join(fixturesDir, file), 'utf8')))
}

export function countByClassification(reports: SampleReport[]): Record<Classification, number> {
	const counts: Record<Classification, number> = { MATCH: 0, DIVERGE: 0, LIMA_ONLY_FAILS: 0, YAML_ONLY_FAILS: 0, BOTH_FAIL: 0 }
	for (const r of reports) counts[r.classification]++
	return counts
}

// CLI entry point: `bun src/run.ts` (or `bun run run` via package.json).
if (import.meta.main) {
	const fixturesDir = join(import.meta.dir, '..', '..', 'fixtures', 'frontmatter-samples')
	const reports = runCompat(fixturesDir)

	if (JSON_OUTPUT) {
		console.log(JSON.stringify(reports, null, 2))
	} else {
		for (const r of reports) {
			console.log(`[${r.classification}] ${r.file}`)
			for (const d of r.diffs ?? []) console.log(`    ${d}`)
			if (r.limaError) console.log(`    lima threw: ${r.limaError}`)
			if (r.yamlError) console.log(`    yaml threw: ${r.yamlError}`)
		}

		const counts = countByClassification(reports)
		const matchRate = reports.length === 0 ? 0 : (counts.MATCH / reports.length) * 100
		console.log(`\n${matchRate.toFixed(1)}% match (${counts.MATCH}/${reports.length} samples)`)
		console.log(
			`  MATCH: ${counts.MATCH}  DIVERGE: ${counts.DIVERGE}  ` +
				`LIMA_ONLY_FAILS: ${counts.LIMA_ONLY_FAILS}  YAML_ONLY_FAILS: ${counts.YAML_ONLY_FAILS}  ` +
				`BOTH_FAIL: ${counts.BOTH_FAIL}`
		)
	}
}
