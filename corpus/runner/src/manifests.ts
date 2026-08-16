import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ManifestEntry {
	path: string
	id: string
	sha256: string
	/**
	 * The Core / References revision that first added this case. Baseline
	 * cases carry the `.0` revision (`1.0.0`); cases added by a later errata
	 * revision carry that revision (`1.0.1`, …). The baseline set — every
	 * entry whose `since` equals `baselineVersion` — is immutable: its files,
	 * ids, and content hashes never change. Later revisions may only *add*
	 * cases, never alter or remove a baseline one.
	 */
	since: string
}

export interface SuiteManifest {
	suite: 'core-1.0' | 'references-1.0'
	frozen: true
	/** The immutable baseline revision. */
	baselineVersion: string
	/** How many cases belong to the baseline revision — pinned. */
	baselineCaseCount: number
	/** The highest revision represented in `cases`. */
	specVersion: string
	caseCount: number
	cases: ManifestEntry[]
}

const directoryFor = (suite: SuiteManifest['suite']): string =>
	suite === 'core-1.0' ? 'core' : 'references'

interface ScannedCase {
	path: string
	id: string
	sha256: string
}

/** Path / id / content hash of every case file in a suite directory, sorted by path. */
export function scanSuiteFiles(corpusRoot: string, suite: SuiteManifest['suite']): ScannedCase[] {
	const directory = directoryFor(suite)
	return readdirSync(join(corpusRoot, directory))
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name): ScannedCase => {
			const path = `${directory}/${name}`
			const bytes = readFileSync(join(corpusRoot, path))
			const doc = JSON.parse(bytes.toString('utf8')) as { id: string }
			return { path, id: doc.id, sha256: createHash('sha256').update(bytes).digest('hex') }
		})
}

/**
 * Regenerates a suite manifest from disk, carrying `since` forward for every
 * case the prior manifest already listed and stamping `newVersion` on any
 * case the prior manifest did not. The baseline (`baselineVersion` /
 * `baselineCaseCount`) is carried through untouched. If the prior manifest
 * predates the `since` mechanism, every one of its cases is adopted as the
 * baseline.
 */
export function regenerateManifest(
	corpusRoot: string,
	prior: SuiteManifest | LegacyManifest,
	newVersion: string,
): SuiteManifest {
	const legacy = !('baselineVersion' in prior)
	// A pre-`since` manifest recorded its baseline as the two-part spec
	// version (`1.0`); normalise it to the spec's own three-part form.
	const baselineVersion = legacy
		? (/^\d+\.\d+$/.test(prior.specVersion) ? `${prior.specVersion}.0` : prior.specVersion)
		: prior.baselineVersion
	const priorSince = new Map(
		prior.cases.map((entry) => [entry.path, 'since' in entry ? entry.since : baselineVersion]),
	)
	const cases: ManifestEntry[] = scanSuiteFiles(corpusRoot, prior.suite).map((scanned) => ({
		...scanned,
		since: priorSince.get(scanned.path) ?? newVersion,
	}))
	const baselineCaseCount = legacy
		? prior.cases.length
		: prior.baselineCaseCount
	return {
		suite: prior.suite,
		frozen: true,
		baselineVersion,
		baselineCaseCount,
		specVersion: newVersion,
		caseCount: cases.length,
		cases,
	}
}

interface LegacyManifest {
	suite: SuiteManifest['suite']
	specVersion: string
	frozen: true
	caseCount: number
	cases: { path: string; id: string; sha256: string }[]
}

export function verifyFrozenManifest(
	corpusRoot: string,
	manifest: SuiteManifest,
): string[] {
	const errors: string[] = []
	const scanned = scanSuiteFiles(corpusRoot, manifest.suite)

	if (manifest.caseCount !== manifest.cases.length) {
		errors.push(`caseCount ${manifest.caseCount} does not match the ${manifest.cases.length} listed cases`)
	}
	if (scanned.length !== manifest.caseCount) {
		errors.push(`expected ${manifest.caseCount} cases on disk, found ${scanned.length}`)
	}

	const baseline = manifest.cases.filter((entry) => entry.since === manifest.baselineVersion)
	if (baseline.length !== manifest.baselineCaseCount) {
		errors.push(
			`baseline: expected ${manifest.baselineCaseCount} cases at ${manifest.baselineVersion}, ` +
			`manifest lists ${baseline.length}`,
		)
	}

	const listedByPath = new Map(manifest.cases.map((entry) => [entry.path, entry]))
	const scannedByPath = new Map(scanned.map((entry) => [entry.path, entry]))
	for (const [path, expected] of listedByPath) {
		const found = scannedByPath.get(path)
		if (found === undefined) {
			errors.push(`missing ${path}`)
			continue
		}
		if (found.id !== expected.id) errors.push(`${path}: expected id ${expected.id}, found ${found.id}`)
		if (found.sha256 !== expected.sha256) errors.push(`${path}: content hash changed`)
	}
	for (const path of scannedByPath.keys()) {
		if (!listedByPath.has(path)) errors.push(`unexpected ${path} (not listed in the manifest)`)
	}
	return errors
}
