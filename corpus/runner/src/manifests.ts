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

/**
 * SHA-256 over the baseline set — every entry whose `since` equals
 * `baselineVersion` — as `path \t id \t sha256` lines, ordered by path.
 *
 * This is the independent anchor the freeze rests on. `regenerateManifest`
 * carries baseline entries forward verbatim and cannot alter them; a
 * hand-edit of the manifest that changes a baseline path, id, or content
 * hash therefore also changes this fingerprint, and `verifyFrozenManifest`
 * checks the recomputed fingerprint against `BASELINE_DIGESTS` below — a
 * constant that lives in source, not in the regenerable manifest. Moving
 * the baseline now takes a third, deliberate edit right next to this note.
 */
export function baselineFingerprint(
	cases: readonly ManifestEntry[],
	baselineVersion: string,
): string {
	const lines = cases
		.filter((entry) => entry.since === baselineVersion)
		.map((entry) => ({ ...entry }))
		.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
		.map((entry) => `${entry.path}\t${entry.id}\t${entry.sha256}`)
	return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/**
 * The frozen baseline fingerprint of each 1.0 suite. Set once when the
 * baseline is declared; changing a value here is the same act as breaking
 * the freeze, and must be reviewed as such.
 */
export const BASELINE_DIGESTS: Record<SuiteManifest['suite'], string> = {
	'core-1.0': '35957b2f1803b76eeb328b687b3dd9231d192523598c1ada46b47c914b48cd68',
	'references-1.0': '30297b357407cabad225b5e38d5167367680023da03e5df75ee7d435a7c93915',
}

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
 * Regenerates a suite manifest from disk. Errata cases the prior manifest
 * already listed keep their `since`; new files are stamped `newVersion`.
 *
 * Baseline entries — `since === baselineVersion` — are **not** re-read from
 * disk: their `path`, `id`, and `sha256` are carried forward from the prior
 * manifest verbatim. If a baseline case file has since been edited or
 * removed, regeneration throws rather than absorbing the change, and the
 * recomputed baseline fingerprint is checked against `BASELINE_DIGESTS`.
 * Regeneration is an add-only operation over the baseline.
 *
 * If the prior manifest predates the `since` mechanism, every one of its
 * cases is adopted as the baseline (one-time migration).
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
	const priorByPath = new Map(
		prior.cases.map((entry) => [
			entry.path,
			{ ...entry, since: 'since' in entry ? entry.since : baselineVersion },
		]),
	)
	const scanned = scanSuiteFiles(corpusRoot, prior.suite)
	const scannedByPath = new Map(scanned.map((entry) => [entry.path, entry]))

	const cases: ManifestEntry[] = scanned.map((entry): ManifestEntry => {
		const priorEntry = priorByPath.get(entry.path)
		const since = priorEntry?.since ?? newVersion
		if (since !== baselineVersion) return { ...entry, since }
		// Baseline case: carry the prior manifest's record forward untouched,
		// and refuse to regenerate over an edited baseline file.
		if (priorEntry === undefined) {
			throw new Error(`${entry.path}: new file cannot join the frozen ${baselineVersion} baseline`)
		}
		if (entry.sha256 !== priorEntry.sha256 || entry.id !== priorEntry.id) {
			throw new Error(
				`${entry.path}: baseline case changed on disk (id/content hash) — the ` +
				`${baselineVersion} baseline is frozen and cannot be regenerated`,
			)
		}
		return { path: priorEntry.path, id: priorEntry.id, sha256: priorEntry.sha256, since }
	})

	for (const entry of priorByPath.values()) {
		if (entry.since === baselineVersion && !scannedByPath.has(entry.path)) {
			throw new Error(`${entry.path}: baseline case removed — the ${baselineVersion} baseline is frozen`)
		}
	}

	const baselineCaseCount = legacy ? prior.cases.length : prior.baselineCaseCount
	const fingerprint = baselineFingerprint(cases, baselineVersion)
	if (!legacy && fingerprint !== BASELINE_DIGESTS[prior.suite]) {
		throw new Error(
			`${prior.suite}: baseline fingerprint ${fingerprint} does not match the ` +
			`pinned digest — the prior manifest's baseline has been tampered with`,
		)
	}

	// `specVersion` is the highest revision actually represented in `cases`,
	// not whatever `newVersion` a caller passed: regenerating an errata-free
	// suite with an unrelated version number must not bump it.
	const specVersion = cases.reduce(
		(hi, entry) => (entry.since.localeCompare(hi, undefined, { numeric: true }) > 0 ? entry.since : hi),
		baselineVersion,
	)

	return {
		suite: prior.suite,
		frozen: true,
		baselineVersion,
		baselineCaseCount,
		specVersion,
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

	const pinned = BASELINE_DIGESTS[manifest.suite]
	const fingerprint = baselineFingerprint(manifest.cases, manifest.baselineVersion)
	if (fingerprint !== pinned) {
		errors.push(
			`baseline fingerprint ${fingerprint} does not match the pinned digest ${pinned} — ` +
			`a frozen ${manifest.baselineVersion} case's path, id, or content has been altered`,
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
