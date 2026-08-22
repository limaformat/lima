/**
 * Regenerates the frozen 1.x conformance manifests after cases are added by
 * an errata revision.
 *
 *   bun scripts/write-frozen-manifests.ts <newVersion> [suite...]
 *
 * `newVersion` (e.g. `1.0.1`) is stamped as `since` on every case the prior
 * manifest did not already list. Baseline cases (`since === baselineVersion`)
 * are carried through verbatim — regeneration throws rather than absorbing an
 * edited or removed baseline file, and re-checks the baseline fingerprint
 * against the pinned `BASELINE_DIGESTS`. `specVersion` follows the highest
 * revision actually present, so passing a Core version here does not bump an
 * errata-free References manifest.
 *
 * With no suite arguments, every manifest under `corpus/manifests/` is
 * regenerated.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { regenerateManifest, type SuiteManifest } from '../src/manifests'

const corpusRoot = join(import.meta.dir, '..', '..')
const manifestDir = join(corpusRoot, 'manifests')

const [newVersion, ...suiteArgs] = process.argv.slice(2)
if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
	console.error('usage: bun scripts/write-frozen-manifests.ts <newVersion> [suite...]')
	console.error('  <newVersion> must look like 1.0.1')
	process.exit(1)
}

const files = suiteArgs.length > 0
	? suiteArgs.map((suite) => `${suite}.json`)
	: readdirSync(manifestDir).filter((name) => name.endsWith('.json')).sort()

for (const file of files) {
	const path = join(manifestDir, file)
	const prior = JSON.parse(readFileSync(path, 'utf8')) as SuiteManifest
	const next = regenerateManifest(corpusRoot, prior, newVersion)
	writeFileSync(path, JSON.stringify(next, null, 2) + '\n')
	const added = next.caseCount - next.baselineCaseCount
	console.log(
		`${file}: ${next.caseCount} cases ` +
		`(${next.baselineCaseCount} baseline @ ${next.baselineVersion}` +
		`${added > 0 ? `, ${added} added through ${next.specVersion}` : ''})`,
	)
}
