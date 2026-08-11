import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { verifyFrozenManifest, type SuiteManifest } from '../src/manifests'

const corpusRoot = join(import.meta.dir, '..', '..')

describe('frozen Lima 1.0 corpus manifests', () => {
	for (const name of ['core-1.0', 'references-1.0'] as const) {
		it(`${name} files, IDs, and contents are unchanged`, () => {
			const path = join(corpusRoot, 'manifests', `${name}.json`)
			const manifest = JSON.parse(readFileSync(path, 'utf8')) as SuiteManifest
			expect(verifyFrozenManifest(corpusRoot, manifest)).toEqual([])
		})
	}
})
