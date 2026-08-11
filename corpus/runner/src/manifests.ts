import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ManifestEntry {
	path: string
	id: string
	sha256: string
}

export interface SuiteManifest {
	suite: 'core-1.0' | 'references-1.0'
	specVersion: '1.0'
	frozen: true
	caseCount: number
	cases: ManifestEntry[]
}

const directoryFor = (suite: SuiteManifest['suite']): string =>
	suite === 'core-1.0' ? 'core' : 'references'

export function buildFrozenManifest(
	corpusRoot: string,
	suite: SuiteManifest['suite'],
): SuiteManifest {
	const directory = directoryFor(suite)
	const cases = readdirSync(join(corpusRoot, directory))
		.filter((name) => name.endsWith('.json'))
		.sort()
		.map((name): ManifestEntry => {
			const path = `${directory}/${name}`
			const bytes = readFileSync(join(corpusRoot, path))
			const doc = JSON.parse(bytes.toString('utf8')) as { id: string }
			return {
				path,
				id: doc.id,
				sha256: createHash('sha256').update(bytes).digest('hex'),
			}
		})
	return { suite, specVersion: '1.0', frozen: true, caseCount: cases.length, cases }
}

export function verifyFrozenManifest(
	corpusRoot: string,
	manifest: SuiteManifest,
): string[] {
	const actual = buildFrozenManifest(corpusRoot, manifest.suite)
	const errors: string[] = []
	if (actual.caseCount !== manifest.caseCount) {
		errors.push(`expected ${manifest.caseCount} cases, found ${actual.caseCount}`)
	}
	const expectedByPath = new Map(manifest.cases.map((entry) => [entry.path, entry]))
	const actualByPath = new Map(actual.cases.map((entry) => [entry.path, entry]))
	for (const [path, expected] of expectedByPath) {
		const found = actualByPath.get(path)
		if (found === undefined) errors.push(`missing ${path}`)
		else {
			if (found.id !== expected.id) errors.push(`${path}: expected id ${expected.id}, found ${found.id}`)
			if (found.sha256 !== expected.sha256) errors.push(`${path}: content hash changed`)
		}
	}
	for (const path of actualByPath.keys()) {
		if (!expectedByPath.has(path)) errors.push(`unexpected ${path}`)
	}
	return errors
}
