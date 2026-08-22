import { describe, expect, it } from 'bun:test'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	BASELINE_DIGESTS,
	baselineFingerprint,
	regenerateManifest,
	verifyFrozenManifest,
	type SuiteManifest,
} from '../src/manifests'

const corpusRoot = join(import.meta.dir, '..', '..')
const suites = ['core-1.0', 'references-1.0'] as const
const loadManifest = (name: string): SuiteManifest =>
	JSON.parse(readFileSync(join(corpusRoot, 'manifests', `${name}.json`), 'utf8'))

describe('frozen Lima 1.0 corpus manifests', () => {
	for (const name of suites) {
		it(`${name} files, IDs, and contents are unchanged`, () => {
			expect(verifyFrozenManifest(corpusRoot, loadManifest(name))).toEqual([])
		})

		it(`${name} baseline fingerprint matches the pinned digest`, () => {
			const manifest = loadManifest(name)
			expect(baselineFingerprint(manifest.cases, manifest.baselineVersion)).toBe(BASELINE_DIGESTS[name])
		})
	}
})

describe('regenerateManifest — the baseline is add-only', () => {
	it('is a no-op over baseline entries on the honest tree', () => {
		for (const name of suites) {
			const prior = loadManifest(name)
			const next = regenerateManifest(corpusRoot, prior, prior.specVersion)
			const baselineOf = (m: SuiteManifest) =>
				m.cases.filter((c) => c.since === m.baselineVersion)
			expect(baselineOf(next)).toEqual(baselineOf(prior))
			expect(next.baselineCaseCount).toBe(prior.baselineCaseCount)
		}
	})

	it('throws instead of absorbing an edited baseline case file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'lima-manifest-freeze-'))
		try {
			cpSync(join(corpusRoot, 'core'), join(dir, 'core'), { recursive: true })
			cpSync(join(corpusRoot, 'references'), join(dir, 'references'), { recursive: true })

			const prior = loadManifest('core-1.0')
			const victim = prior.cases.find((c) => c.since === prior.baselineVersion)!
			const victimPath = join(dir, victim.path)
			const doc = JSON.parse(readFileSync(victimPath, 'utf8'))
			doc.description = `${doc.description ?? ''} (tampered)`
			writeFileSync(victimPath, JSON.stringify(doc, null, 2) + '\n')

			expect(() => regenerateManifest(dir, prior, '1.0.5')).toThrow(
				/baseline case changed on disk/,
			)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})

	it('throws when the prior manifest itself carries a tampered baseline', () => {
		const prior = loadManifest('core-1.0')
		const tampered: SuiteManifest = {
			...prior,
			cases: prior.cases.map((c, i) =>
				i === 0 ? { ...c, sha256: 'deadbeef'.repeat(8) } : c,
			),
		}
		expect(() => regenerateManifest(corpusRoot, tampered, '1.0.5')).toThrow(
			/baseline case changed on disk|baseline fingerprint/,
		)
	})
})

describe('verifyFrozenManifest — pinned baseline digest', () => {
	it('reports a fingerprint mismatch for a doctored baseline entry', () => {
		const prior = loadManifest('core-1.0')
		const doctored: SuiteManifest = {
			...prior,
			cases: prior.cases.map((c) =>
				c.since === prior.baselineVersion && c.path === prior.cases[0]!.path
					? { ...c, sha256: '0'.repeat(64) }
					: c,
			),
		}
		const errors = verifyFrozenManifest(corpusRoot, doctored)
		expect(errors.some((e) => /baseline fingerprint .* does not match the pinned digest/.test(e))).toBe(true)
	})
})
